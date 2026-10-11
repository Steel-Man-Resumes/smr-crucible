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
import { finishPayloadFromRun } from "@/lib/finish-payload";
import { coreStore, pickForgeArtifact, saveFinishRevision, type SavedRevisionSummary } from "@/lib/revision-save";
import { withRevisionMarker } from "@/lib/revision-marker";

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

/** What the save did with the finished resume, if the run had one. */
export interface PersistResult {
  /** The saved revision (081), or null when the run had no finished state. */
  revision: SavedRevisionSummary | null;
  /** The finished state was there but could not be saved as sent (it was not valid). */
  revisionProblem?: string;
}

/** A save of the finished state that failed for a reason worth retrying. */
export class RevisionSaveError extends Error {}

export async function persistForgeSession(
  userId: string,
  body: Record<string, any>
): Promise<PersistResult> {
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
      // The original Forge resume (a fork copies the "forge" tag; the original wins).
      const forgeResume = pickForgeArtifact(existing);

      // Phase 5 R1 (review A1): once the Forge resume has a saved revision,
      // that revision is the finished document. Never rebuild the account's
      // copy from the run's earlier inputs over it (a cut skill would come back).
      const { getLatestRevision } = await import("@crucible/core");
      // No catch (review L2): a read error is NOT "no revision". It fails this
      // save (the outer catch logs it and the Forge save still stands), and the
      // run's earlier inputs never overwrite a finished resume on a guess.
      const hasRevision = forgeResume ? !!(await getLatestRevision(userId, forgeResume.id)) : false;
      if (forgeResume && hasRevision) {
        // The revision save below keeps the content in step with the finished text.
      } else if (forgeResume) {
        // Lock-guarded: if the forge resume was locked as a baseline, the
        // update is refused server-side and we leave it untouched rather
        // than overwrite an approved document (Phase 0.1).
        // Marked "derived": the server built it from the run (review M2), so a
        // later finish save may replace it without keeping it as a revision.
        const result = await updateArtifact(
          forgeResume.id,
          userId,
          withRevisionMarker(resumeContent as unknown as Record<string, unknown>, "", { kind: "derived" }),
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
          withRevisionMarker(resumeContent as unknown as Record<string, unknown>, "", { kind: "derived" }),
          1.0
        );
        // Career lanes (074): the first finished Forge resume becomes the
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

  // Phase 5 R1 (review A1): the finished resume itself, as a saved revision.
  // The import sends it as `finish`; the Refinery's sync sends the whole run,
  // whose stored finish is rebuilt the same way (only when it belongs to this
  // run). The server runs the gate itself; nothing here trusts a status.
  const finish = body.finish && typeof body.finish === "object" ? body.finish : finishPayloadFromRun(body);
  if (!finish) return { revision: null };
  // A finished state the writer never signed (written before the receipt
  // existed, or caught mid-write) is not saved from here: it could only be a
  // draft, and the finish page saves its own version when it opens signed in.
  if (typeof (finish as Record<string, unknown>).writerReceipt !== "string" || !(finish as Record<string, unknown>).writerReceipt) return { revision: null, revisionProblem: "no receipt" };
  const laneTarget = firstLaneTarget({}, body);
  const saved = await saveFinishRevision(userId, finish, { source: "forge_import", laneTarget }, await coreStore());
  if (saved.ok) return { revision: saved.revision };
  // Not valid as sent: the rest of the run is saved; say so, never pretend.
  // Before 081 is applied (503 not_ready) the run still saves as it always did.
  if (saved.status === 400 || saved.status === 413 || saved.status === 404 || saved.status === 503) return { revision: null, revisionProblem: saved.reason };
  throw new RevisionSaveError(saved.reason);
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
