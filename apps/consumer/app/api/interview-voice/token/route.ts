/**
 * Interview Voice Reservation API
 *
 * Phase 1D: this route used to mint an OpenAI Realtime ephemeral client
 * secret and hand it straight to the browser, which then POSTed the SDP
 * offer directly to api.openai.com -- the server never learned a call
 * happened, so there was no duration cap, no metering, and no way to stop
 * an abandoned session. It no longer talks to OpenAI at all.
 *
 * Now this route only reserves a server-side lease (voice_session, see
 * packages/core/src/voiceSession.ts) against a daily minute budget and a
 * one-active-session-per-user rule. The browser takes the returned
 * sessionId to POST /api/interview-voice/call, which is the route that
 * actually relays the SDP exchange to OpenAI using the server's own API
 * key -- the ephemeral client secret is gone because nothing on the
 * client needs to authenticate to OpenAI directly anymore.
 *
 * Retention (Phase 1B, honest disclosure, unchanged by this route's
 * rewrite): the session config sent to OpenAI by the call route passes no
 * retention parameters, so OpenAI's default retention applies to the audio
 * and transcript that flow through their Realtime API -- we do not control
 * or shorten it from here. The UI-facing sentence for this lives on the
 * interview page's voice-practice control and in SecurityContent.tsx.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { reserveVoiceSession } from "@crucible/core";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { REALTIME_MODEL, type VoiceSessionBody } from "@/lib/voice-instructions";

export const maxDuration = 15;

const MAX_REQUEST_BYTES = 100_000;

const BUDGET_EXHAUSTED_MESSAGE =
  "You have used your voice practice time for today. It resets tomorrow.";
const ALREADY_ACTIVE_MESSAGE =
  "A voice session is already running. End it first, then start a new one.";

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Voice practice is not configured" },
      { status: 500 }
    );
  }

  let body: VoiceSessionBody = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const targetRole = sanitizeForPrompt(body.config?.targetRole, 120);

  const reservation = await reserveVoiceSession(userId, targetRole);

  if (reservation.status === "budget_exhausted") {
    return NextResponse.json(
      {
        error: "budget_exhausted",
        message: BUDGET_EXHAUSTED_MESSAGE,
        remainingSeconds: reservation.remainingSeconds,
      },
      { status: 429 }
    );
  }

  if (reservation.status === "already_active") {
    return NextResponse.json(
      { error: "already_active", message: ALREADY_ACTIVE_MESSAGE },
      { status: 409 }
    );
  }

  try {
    const { logDecision } = await import("@crucible/core");
    await logDecision({
      userId,
      contextPage: "interview-voice",
      modelProvider: "openai",
      modelId: REALTIME_MODEL,
      input: JSON.stringify({
        targetRole: body.config?.targetRole,
        interviewType: body.config?.interviewType,
        includeDisclosure: body.config?.includeDisclosure,
      }).slice(0, 500),
      explanation:
        "Reserved a server-side voice practice lease (Phase 1D minute budget).",
      outputSummary: {
        type: "interview_voice_reservation",
        model: REALTIME_MODEL,
        reservedSeconds: reservation.session.reserved_seconds,
      },
    });
  } catch (err) {
    console.error("Decision log failed (interview voice):", err);
  }

  return NextResponse.json({
    sessionId: reservation.session.id,
    reservedSeconds: reservation.session.reserved_seconds,
  });
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "interview",
  requiredTier: "client",
});
