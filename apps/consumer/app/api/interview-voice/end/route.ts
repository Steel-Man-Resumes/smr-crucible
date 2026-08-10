/**
 * Interview Voice End API (Phase 1D)
 *
 * The browser calls this when the user hits "End voice session," or on
 * cleanup. It closes the server-side lease (voice_session), best-effort
 * hangs up the OpenAI call if one was captured (POST
 * /v1/realtime/calls/{call_id}/hangup -- see the call route's doc comment
 * for the source), and records the elapsed audio time to ai_token_usage so
 * the per-user AI cost view stays accurate.
 *
 * A session left open past its lease (crashed tab, closed laptop, network
 * drop) is NOT this route's job -- that's
 * apps/consumer/app/api/cron/voice-reconcile/route.ts, which runs every 10
 * minutes.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { endVoiceSession } from "@crucible/core";
import { recordTokenUsage } from "@/lib/ai-usage-log";
import { REALTIME_MODEL } from "@/lib/voice-instructions";

export const maxDuration = 15;

async function hangupProviderCall(callId: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
  } catch (err) {
    // Best-effort. The lease is already closed on our side regardless --
    // see the doc comment on voiceSession.ts for why this doesn't weaken
    // the enforcement guarantee.
    console.error("Voice call hangup failed:", err);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { sessionId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const sessionId = body.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const ended = await endVoiceSession(userId, sessionId, "user_ended");
  if (!ended) {
    // Idempotent from the client's point of view: nothing active to end is
    // not an error worth surfacing (e.g. a double stop-click, or the cron
    // already reconciled an expired lease).
    return NextResponse.json({ ok: true, elapsedSeconds: 0 });
  }

  if (ended.session.call_id) {
    await hangupProviderCall(ended.session.call_id);
  }

  recordTokenUsage(
    "openai",
    REALTIME_MODEL,
    { inputTokens: 0, outputTokens: 0, audioSeconds: ended.elapsedSeconds },
    { userId, endpoint: "interview-voice" }
  );

  return NextResponse.json({ ok: true, elapsedSeconds: ended.elapsedSeconds });
}
