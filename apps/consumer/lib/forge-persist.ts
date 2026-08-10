/**
 * Persist an anonymous Forge session onto a user account.
 *
 * Saves the forge_session / consumer_profile records and best-effort
 * auto-creates (or updates) the "forge" source resume artifact.
 *
 * Shared by:
 *  - /api/forge/save     (post-auth localStorage relay on the dashboard)
 *  - /api/auth/register  (so Forge work carries across the forge.* -> refinery.*
 *                         origin boundary at account creation, where the
 *                         localStorage relay can't reach it)
 */

import {
  saveForgeSession,
  createArtifact,
  updateArtifact,
  listArtifacts,
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

      const existing = await listArtifacts(userId, { type: "resume" });
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
        await createArtifact(
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
