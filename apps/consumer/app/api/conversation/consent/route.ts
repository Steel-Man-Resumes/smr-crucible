/**
 * POST /api/conversation/consent -- grant or revoke the opt-in transcript
 * layer that gates saving a rehearsal/interview practice conversation (Phase
 * 5.5).
 *
 * This is deliberately SEPARATE from /api/consent, which excludes the transcript
 * layers on purpose (they are granted in-context, at the practice space, not in
 * a settings list). Granting here is the durable "always allow saving my
 * practice conversations" choice; revoking here turns auto-saving back off (a
 * one-time save revokes on "I'm done").
 *
 * Body: { purpose, action }
 *   purpose : "disclosure_rehearsal" | "interview_voice"
 *   action  : "grant" | "revoke"
 *
 * Revoking does NOT delete anything already saved -- it only stops future turns
 * from being stored. Deleting saved practice is Settings -> delete my data.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  grantConsent,
  revokeConsent,
  consentLayerForPurpose,
  isConversationPurpose,
  isConsentGranted,
  CONSENT_TEXT_VERSION,
} from "@crucible/core";

export const maxDuration = 10;

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const purpose = body?.purpose;
  const action = body?.action;

  if (!isConversationPurpose(purpose)) {
    return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
  }
  if (action !== "grant" && action !== "revoke") {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 });
  }

  const layer = consentLayerForPurpose(purpose);

  try {
    if (action === "grant") {
      await grantConsent(
        userId,
        layer,
        CONSENT_TEXT_VERSION,
        { source: "rehearsal_prompt" },
        { collectionMethod: "rehearsal_prompt" }
      );
    } else {
      await revokeConsent(userId, layer, { collectionMethod: "rehearsal_prompt" });
    }
    const granted = await isConsentGranted(userId, layer);
    return NextResponse.json({ granted });
  } catch (err: any) {
    console.error("conversation consent update failed:", err?.message || err);
    return NextResponse.json({ error: "Could not update consent" }, { status: 500 });
  }
}

/** GET -> is the transcript layer for this purpose currently granted. */
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const purpose = new URL(request.url).searchParams.get("purpose");
  if (!isConversationPurpose(purpose)) {
    return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
  }
  const granted = await isConsentGranted(userId, consentLayerForPurpose(purpose));
  return NextResponse.json({ granted });
}
