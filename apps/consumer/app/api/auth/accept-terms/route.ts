/**
 * POST /api/auth/accept-terms
 *
 * Records that the signed-in account accepts the Terms, Privacy Policy and
 * AI-processing notice (lib/terms.ts), in the same consent rows password
 * registration writes. For accounts made by email link or Google, which never
 * saw the sign-up checkbox (security review 3a r1, M4), and older accounts with
 * no row. The page then calls update(), and the session's `terms` claim is
 * re-read from the row (auth.ts), never from anything sent here.
 *
 * Same-origin JSON only. The middleware already turns away a revoked session
 * and holds one that still owes its second step.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@crucible/core";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { forgeSessionUser } from "@/lib/session-policy";
import {
  CONSENT_CONTEXT,
  CONSENT_EVENT_SQL,
  CONSENT_UPSERT_SQL,
  TERMS_VERSION,
  acceptanceMethod,
  consentMethodFor,
} from "@/lib/terms";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const session = await auth();
  const user = forgeSessionUser(session);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { accept?: unknown; source?: unknown } | null;
  if (!body || body.accept !== true) {
    return NextResponse.json({ error: "Nothing to record" }, { status: 400 });
  }
  // L4: the ledger records HOW the person accepted (a tap on the terms page,
  // or the box they ticked on the email-link form), from a fixed list. How
  // they signed in is kept beside it, in the context.
  const method = acceptanceMethod(body.source);
  if (!method) {
    return NextResponse.json({ error: "Nothing to record" }, { status: 400 });
  }
  const signedInWith = consentMethodFor((session?.user as any)?.via);
  try {
    await query(CONSENT_UPSERT_SQL, [
      user.id,
      TERMS_VERSION,
      JSON.stringify({ via: method, signed_in_with: signedInWith, ...CONSENT_CONTEXT }),
    ]);
    await query(CONSENT_EVENT_SQL, [
      user.id,
      TERMS_VERSION,
      method,
      JSON.stringify({ ...CONSENT_CONTEXT, signed_in_with: signedInWith }),
    ]);
  } catch (err: any) {
    console.error("[accept-terms] could not record:", err?.message || err);
    return NextResponse.json({ error: "We couldn't save that. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, version: TERMS_VERSION });
}
