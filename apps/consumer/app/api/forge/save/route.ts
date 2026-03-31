import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveForgeSession, createArtifact, updateArtifact, listArtifacts } from "@crucible/core";
import { buildForgeResumeContent } from "@/lib/forge-to-resume";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const sessionId = body.startedAt || new Date().toISOString();

  try {
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

    // Auto-create (or update) a resume artifact from Forge data (non-fatal)
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
          // Update existing forge resume with new data
          await updateArtifact(
            forgeResume.id,
            userId,
            resumeContent as unknown as Record<string, unknown>,
            1.0
          );
        } else {
          // Create new forge resume
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
        console.error("Auto-create resume artifact failed:", artErr?.message || artErr);
        // Non-fatal: Forge save succeeded, artifact creation is best-effort
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Forge save error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save progress. Please try again." },
      { status: 500 }
    );
  }
}
