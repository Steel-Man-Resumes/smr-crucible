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

  // Auto-create (or update) a resume artifact from Forge data (non-fatal).
  if (body.forgeOutput) {
    try {
      const resumeContent = buildForgeResumeContent({
        resumeText: body.resumeText,
        forgeOutput: body.forgeOutput,
      });

      const existing = await listArtifacts(userId, { type: "resume" });
      const forgeResume = existing.find(
        (a) => (a.target_context as any)?.source === "forge"
      );

      if (forgeResume) {
        await updateArtifact(
          forgeResume.id,
          userId,
          resumeContent as unknown as Record<string, unknown>,
          1.0
        );
      } else {
        await createArtifact(
          userId,
          "resume",
          {
            source: "forge",
            targetJob: resumeContent.meta.targetJob || "General",
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
