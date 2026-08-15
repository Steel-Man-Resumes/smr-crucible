/**
 * POST /api/conversation/chunk -- persist ONE text turn of a rehearsal or
 * interview practice run (Phase 5.1).
 *
 * Body: { purpose, sessionId, seq, role, text }
 *   purpose   : "disclosure_rehearsal" | "interview_voice"
 *   sessionId : the session this turn belongs to (must be owned by the caller)
 *   seq       : ordinal of this turn (idempotent -- a retry of the same seq
 *               is a no-op, never a dupe)
 *   role      : "user" | "assistant"
 *   text      : the turn's text (TEXT ONLY -- audio never comes here)
 *
 * CONSENT GATE: the SESSION is the unit of consent. A session only exists if
 * the user opted in at creation (durable "always save" OR a one-time
 * "save just this run" -- see /api/conversation/session). So a turn is stored
 * only when it belongs to an owned, already-consented session:
 * appendConversationChunk verifies ownership, and a foreign/missing session
 * 404s. We do NOT re-check the durable consent layer here -- doing so used to
 * force "just this run" to grant the durable layer, which silently turned a
 * one-time choice into always-on. An un-consented run never gets a sessionId
 * (session create returns created:false), so it never reaches this route.
 *
 * NEVER logs the plaintext text and NEVER writes it to decision_log.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import {
  appendConversationChunk,
  isConversationPurpose,
  isConversationRole,
} from "@crucible/core";

export const maxDuration = 10;

const MAX_REQUEST_BYTES = 200_000;
const MAX_TEXT_CHARS = 20_000;

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

  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  const seq = Number(body?.seq);
  const role = body?.role;
  const text = typeof body?.text === "string" ? body.text : "";

  if (!isConversationPurpose(purpose)) {
    return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }
  if (!Number.isInteger(seq) || seq < 0) {
    return NextResponse.json({ error: "Invalid seq" }, { status: 400 });
  }
  if (!isConversationRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "Empty text" }, { status: 400 });
  }

  // No durable-layer re-check here: the owned session (created only after an
  // explicit opt-in) is the consent record. appendConversationChunk 404s a
  // session that isn't the caller's, so an un-consented or forged run stores
  // nothing.
  try {
    await appendConversationChunk({
      ownerUserId: userId,
      purpose,
      sessionId,
      seq,
      role,
      text: text.slice(0, MAX_TEXT_CHARS),
    });
  } catch (err: any) {
    // Never echo the text back in an error. A missing/foreign session is the
    // common case (the store throws "not found") -- surface it as a 404.
    if (String(err?.message || "").includes("not found")) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    console.error("conversation chunk store failed:", err?.message || err);
    return NextResponse.json({ error: "Could not save this turn." }, { status: 500 });
  }

  return NextResponse.json({ stored: true });
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "conversation-chunk",
  requiredTier: "client",
});
