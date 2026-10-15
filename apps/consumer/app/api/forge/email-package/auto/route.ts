/**
 * POST /api/forge/email-package/auto
 *
 * The finish page calls this with the id of the revision it just saved
 * (migration 081) once the server said it is FINISHED. It emails that
 * revision, as attached PDF and Word files, to the account's own proven
 * address, unless the person turned that off. The request carries no address:
 * anything in the body that looks like one is ignored, and no status: the
 * server re-checks the stored revision. All the rules are in
 * lib/email-package-auto.ts; this file only wires the real dependencies.
 *
 * An account route: not on the Forge's anonymous list, so a session that
 * still owes its second step is held (lib/session-policy.ts).
 */

import { packageDeliveryDeps } from "@/lib/package-delivery-worker";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { withRateLimit } from "@/lib/withRateLimit";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { AUTO_ENDPOINT, sendFinishedPackage } from "@/lib/email-package-auto";
import { packageFrom, resendKey, resendTransport } from "@/lib/email-package-send";

async function handlePost(request: Request) {
  // This app's own origin and a JSON body only (security review 3a Part 2 r1,
  // L1): the package box's looser host check would let any steelmanresumes.com host post.
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 400_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const user = forgeSessionUser(await auth());
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const result = await sendFinishedPackage(user.id, body as Record<string, unknown>, await packageDeliveryDeps());
  if (!result.sent && result.reason === "failed") console.error("email-package auto: send failed");
  return NextResponse.json(result, { status: result.sent || result.reason !== "draft" ? 200 : 409 });
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: AUTO_ENDPOINT });
