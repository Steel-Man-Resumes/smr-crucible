/**
 * Persist an anonymous Forge session onto a user account.
 *
 * Saves the forge_session / consumer_profile records and best-effort
 * auto-creates (or updates) the "forge" source resume artifact.
 *
 * Used by /api/forge/save only: the Forge's import (which asks the person and
 * names the account) and the Refinery's sync of runs already marked for its
 * account. Account creation no longer carries a run (security review 3a r1, H1).
 */

import {
  saveForgeSession,
  createArtifact,
  updateArtifact,
  listArtifacts,
  ensureFirstLane,
  setArtifactLane,
  looksLikeExampleResume,
} from "@crucible/core";
import { buildForgeResumeContent } from "@/lib/forge-to-resume";

/** Did the user build a structured base resume in the Forge (Phase 7)? */
function isStructuredResumeDoc(d: any): boolean {
  return (
    !!d &&
    typeof d === "object" &&
    (d.formatVersion === 2 || d.formatVersion === 3) &&
    typeof d.contact === "object" &&
    Array.isArray(d.experience)
  );
}

export async function persistForgeSession(
  userId: string,
  body: Record<string, any>
): Promise<void> {
  const sessionId = body.startedAt || new Date().toISOString();

  await saveForgeSession(userId, sessionId, {
    readinessStage: body.readinessStage,
    resumeText: body.resumeText,
    resumeMethod: body.resumeMethod,
    goals: body.goals,
    goalNarrative: body.goalNarrative,
    challenges: body.challenges,
    criminalRecord: body.criminalRecord,
    challengeNarratives: body.challengeNarratives,
    preferences: body.preferences,
    forgeOutput: body.forgeOutput,
    audience: body.audience,
    pagesVisited: body.pagesVisited,
    startedAt: body.startedAt,
  });

  // Auto-create (or update) the base resume artifact (non-fatal). Prefer the
  // exact structured doc the user built in the Forge (Phase 7) -- it preserves
  // their edits and the bullet-workshop evidence -- and fall back to re-deriving
  // from resumeText + forgeOutput for legacy sessions.
  if (body.forgeOutput || isStructuredResumeDoc(body.resumeDoc)) {
    try {
      const resumeContent = isStructuredResumeDoc(body.resumeDoc)
        ? body.resumeDoc
        : buildForgeResumeContent({
            resumeText: body.resumeText,
            forgeOutput: body.forgeOutput,
          });

      const existing = await listArtifacts(userId, { type: "resume", examples: "hide" });
      const forgeResume = existing.find(
        (a) => (a.target_context as any)?.source === "forge"
      );

      if (forgeResume) {
        // Lock-guarded: if the forge resume was locked as a baseline, the
        // update is refused server-side and we leave it untouched rather
        // than overwrite an approved document (Phase 0.1).
        const result = await updateArtifact(
          forgeResume.id,
          userId,
          resumeContent as unknown as Record<string, unknown>,
          1.0
        );
        if (result.status === "locked") {
          console.warn(
            `Forge re-sync skipped: resume artifact ${forgeResume.id} is a locked baseline`
          );
        }
      } else {
        const created = await createArtifact(
          userId,
          "resume",
          {
            source: "forge",
            // No fallback label here: an empty targetJob lets the UI show
            // "Base resume" instead of a cryptic "General" chip.
            targetJob: resumeContent.meta.targetJob || "",
          },
          resumeContent as unknown as Record<string, unknown>,
          1.0
        );
        // Career lanes (073): the first finished Forge resume becomes the
        // person's first lane, named from their target ("Warehouse"). Only a
        // NEW forge resume does this, and only for someone who has never had
        // a lane, so existing accounts keep working in main until they act.
        // A sample or test resume (reserved fictional contact details) never
        // names the person's first lane.
        if (!looksLikeExampleResume(resumeContent)) {
          await placeInFirstLane(userId, created?.id, firstLaneTarget(resumeContent, body));
        }
      }
    } catch (artErr: any) {
      console.error(
        "Auto-create resume artifact failed:",
        artErr?.message || artErr
      );
      // Non-fatal: the Forge save succeeded; artifact creation is best-effort.
    }
  }
}

/** The target a first lane is named from: the resume's own target, else the Forge's first career path. */
export function firstLaneTarget(resumeContent: any, body: Record<string, any>): string {
  const own = typeof resumeContent?.meta?.targetJob === "string" ? resumeContent.meta.targetJob.trim() : "";
  if (own) return own;
  const path = body?.forgeOutput?.career_paths?.[0]?.title;
  return typeof path === "string" ? path.trim() : "";
}

/** Best effort: a lane problem never fails the Forge save. */
async function placeInFirstLane(userId: string, artifactId: string | undefined, target: string): Promise<void> {
  if (!artifactId || !target) return;
  try {
    const lane = await ensureFirstLane(userId, target);
    if (lane) await setArtifactLane(userId, artifactId, lane.id);
  } catch (err: any) {
    console.error("First lane not created:", err?.message || err);
  }
}
