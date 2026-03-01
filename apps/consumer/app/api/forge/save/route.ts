import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveForgeSession } from "@crucible/core";

export async function POST(request: Request) {
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

  return NextResponse.json({ success: true });
}
