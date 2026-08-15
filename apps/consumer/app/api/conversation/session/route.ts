/**
 * POST /api/conversation/session -- start a rehearsal or interview practice
 * session (Phase 5.1). Returns the new session id the client threads into
 * /api/conversation/chunk.
 *
 * Body: { purpose, targetContext? }
 *   purpose       : "disclosure_rehearsal" | "interview_voice"
 *   targetContext : non-sensitive framing only (role/company/persona for
 *                   disclosure; role/jobApplicationId/jdHash for interview).
 *                   NEVER the transcript.
 *
 * CONSENT GATE: creating a stored session is opt-in and is THE consent unit.
 * It is authorized two ways:
 *   - the durable transcript layer is granted ("always save"), OR
 *   - the request carries sessionConsent: true ("save just this run") -- a
 *     one-time authorization that does NOT grant the durable layer, so a
 *     one-time choice never becomes always-on.
 * With neither, this returns 200 { created: false, reason: "no_consent" } and
 * no row is written. The session's consent_layer records which path applied.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createConversationSession,
  consentLayerForPurpose,
  isConsentGranted,
  isConversationPurpose,
  CONSENT_TEXT_VERSION,
} from "@crucible/core";

export const maxDuration = 10;

const MAX_CONTEXT_BYTES = 4_000;

/** Keep only a bounded, JSON-serializable slice of the client's framing.
 *  target_context is declared non-sensitive, but we still cap it so it can't
 *  become a smuggling channel for a transcript. */
function safeTargetContext(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  try {
    const json = JSON.stringify(raw);
    if (json.length > MAX_CONTEXT_BYTES) return {};
    return JSON.parse(json) as Record<string, unknown>;
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

  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  if (!isConversationPurpose(purpose)) {
    return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
  }

  const layer = consentLayerForPurpose(purpose);
  const durable = await isConsentGranted(userId, layer);
  const oneTime = body?.sessionConsent === true;
  if (!durable && !oneTime) {
    return NextResponse.json({ created: false, reason: "no_consent" });
  }
  // Record HOW consent was given so the session row is self-describing: an
  // "always" session was covered by the durable layer; a "session" session was
  // a one-time opt-in that left no durable grant behind.
  const consentMode = durable ? "always" : "session";

  try {
    const sessionId = await createConversationSession({
      ownerUserId: userId,
      purpose,
      targetContext: safeTargetContext(body?.targetContext),
      // Record the consent path + exact version in effect at session open.
      consentLayer: `${layer}:${consentMode}:${CONSENT_TEXT_VERSION}`,
    });
    return NextResponse.json({ created: true, sessionId });
  } catch (err: any) {
    console.error("conversation session create failed:", err?.message || err);
    return NextResponse.json(
      { error: "Could not start the session." },
      { status: 500 }
    );
  }
}
