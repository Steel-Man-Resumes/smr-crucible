/**
 * Interview Voice Call API (Phase 1D)
 *
 * Server-mediated SDP exchange. The browser used to POST its WebRTC offer
 * straight to https://api.openai.com/v1/realtime/calls using an ephemeral
 * key handed out by the token route. This route replaces that: the browser
 * now sends its SDP offer here, the server relays it to OpenAI with the
 * SERVER's own OpenAI API key, and only relays it at all if the caller
 * already holds an ACTIVE reservation from
 * apps/consumer/app/api/interview-voice/token/route.ts (voice_session,
 * packages/core/src/voiceSession.ts) -- no reservation, no call, full stop.
 *
 * --- OpenAI Realtime "calls" API, confirmed against developers.openai.com
 * docs on 2026-08-10 ---
 * Create a call (WebRTC): POST https://api.openai.com/v1/realtime/calls as
 * multipart/form-data with fields `sdp` (the raw SDP offer text) and
 * `session` (JSON session config), Authorization: Bearer <API key>, and an
 * optional OpenAI-Safety-Identifier header. The response body is the SDP
 * answer as plain text. Docs do not show a worked example of reading the
 * created call's id back from this response (no documented JSON field or
 * header example was found) -- this route defensively checks a `Location`
 * response header (the REST convention OpenAI uses elsewhere for
 * async-created resources: "/v1/realtime/calls/{call_id}") and falls back to
 * leaving call_id null if that header isn't present. A null call_id does
 * NOT weaken the budget/lease enforcement (that lives entirely in
 * voice_session and never depends on call_id) -- it only means the
 * reconciliation cron cannot ask OpenAI to hang up that specific call when
 * its lease expires.
 * Hang up a call: POST https://api.openai.com/v1/realtime/calls/{call_id}/hangup
 * -- documented at developers.openai.com/api/docs/api-reference/realtime-calls.
 * This exists and is used by /api/interview-voice/end and the reconciliation
 * cron (apps/consumer/app/api/cron/voice-reconcile/route.ts).
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachCallId, endVoiceSession, getOne, query } from "@crucible/core";
import { buildVoiceSessionConfig, type VoiceSessionBody } from "@/lib/voice-instructions";

export const maxDuration = 30;

const MAX_SDP_BYTES = 60_000;
const MAX_CONFIG_HEADER_BYTES = 20_000;

interface VoiceSessionRow {
  id: string;
  status: string;
  expires_at: string;
}

function decodeConfigHeader(header: string | null): VoiceSessionBody {
  if (!header) return {};
  try {
    const json = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
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

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const configHeader = request.headers.get("x-voice-config");
  if (configHeader && configHeader.length > MAX_CONFIG_HEADER_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_SDP_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // Must hold an active reservation. Scoped to this user -- another user's
  // sessionId can never be used to ride a lease that isn't theirs.
  const voiceSession = await getOne<VoiceSessionRow>(
    `SELECT id, status, expires_at FROM voice_session
     WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [sessionId, userId]
  );

  if (!voiceSession) {
    return NextResponse.json(
      {
        error: "no_reservation",
        message: "Your voice practice session was not found. Start a new one.",
      },
      { status: 409 }
    );
  }

  if (new Date(voiceSession.expires_at).getTime() < Date.now()) {
    await endVoiceSession(userId, sessionId, "lease_expired");
    return NextResponse.json(
      {
        error: "lease_expired",
        message: "Your voice practice time ran out. Start a new session.",
      },
      { status: 409 }
    );
  }

  // ONE call per lease: claim it atomically before relaying to the provider.
  // Without this, one reservation could open N concurrent provider calls (each
  // POST relays a fresh offer) while the budget ledger counts the lease once.
  const claimed = await query(
    `UPDATE voice_session SET call_id = 'pending'
     WHERE id = $1 AND user_id = $2 AND status = 'active' AND call_id IS NULL
     RETURNING id`,
    [sessionId, userId]
  );
  if (claimed.length === 0) {
    return NextResponse.json(
      {
        error: "call_already_placed",
        message: "This session already has a call. End it and start a new one.",
      },
      { status: 409 }
    );
  }

  const offerSdp = await request.text();
  if (!offerSdp) {
    return NextResponse.json({ error: "Missing SDP offer" }, { status: 400 });
  }

  const body = decodeConfigHeader(configHeader);
  const sessionConfig = buildVoiceSessionConfig(body);

  const safetyIdentifier = crypto
    .createHash("sha256")
    .update(userId)
    .digest("hex");

  const form = new FormData();
  form.set("sdp", offerSdp);
  form.set("session", JSON.stringify(sessionConfig));

  let providerRes: Response;
  try {
    providerRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: form,
    });
  } catch (err) {
    console.error("Realtime call request failed:", err);
    await endVoiceSession(userId, sessionId, "provider_error");
    return NextResponse.json(
      { error: "Could not reach the voice provider" },
      { status: 502 }
    );
  }

  if (!providerRes.ok) {
    const errText = await providerRes.text();
    console.error("Realtime call error:", providerRes.status, errText.slice(0, 500));
    await endVoiceSession(userId, sessionId, "provider_error");
    return NextResponse.json(
      { error: "Could not start voice practice" },
      { status: 502 }
    );
  }

  // Best-effort call id capture -- see the doc comment above on why this is
  // defensive (docs don't show a worked example of where the id lands).
  const location = providerRes.headers.get("location");
  const callId =
    location?.split("/").filter(Boolean).pop() ||
    providerRes.headers.get("x-openai-call-id") ||
    null;
  if (callId) {
    await attachCallId(userId, sessionId, callId).catch((err) => {
      console.error("attachCallId failed:", err);
    });
  }

  const answerSdp = await providerRes.text();
  return new Response(answerSdp, {
    status: 200,
    headers: { "Content-Type": "application/sdp" },
  });
}
