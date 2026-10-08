/**
 * POST /api/forge/email-package/auto
 *
 * The finish page calls this once a signed-in person's resume is FINISHED.
 * It emails the package to the account's own proven address, unless the
 * person turned that off. The request carries no address: anything in the
 * body that looks like one is ignored. All the rules are
 * in lib/email-package-auto.ts; this file only wires the real dependencies.
 *
 * An account route: not on the Forge's anonymous list, so a session that
 * still owes its second step is held (lib/session-policy.ts).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { withRateLimit } from "@/lib/withRateLimit";
import { originAllowed } from "@/lib/email-package-guard";
import { AUTO_ENDPOINT, sendFinishedPackage } from "@/lib/email-package-auto";
import { packageFrom, resendKey, resendTransport } from "@/lib/email-package-send";

async function handlePost(request: Request) {
  if (!originAllowed(request.headers.get("origin"), request.url)) {
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
  const { getPackageEmailTarget, incrementIpUsage, claimPackageEmailVersion, releasePackageEmailVersion } =
    await import("@crucible/core");
  const key = resendKey();
  const result = await sendFinishedPackage(user.id, body as Record<string, unknown>, {
    target: getPackageEmailTarget,
    count: incrementIpUsage,
    claim: claimPackageEmailVersion,
    release: releasePackageEmailVersion,
    transport: key ? resendTransport(key) : null,
    from: packageFrom(),
  });
  if (!result.sent && result.reason === "failed") console.error("email-package auto: send failed");
  return NextResponse.json(result, { status: result.sent || result.reason !== "draft" ? 200 : 409 });
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: AUTO_ENDPOINT });
