/**
 * Admin: premium access (migration 079). Platform admins only, with a
 * two-step sign-in (requirePlatformAdmin). Every write runs AS the admin, so
 * the database names them on the row.
 *
 * GET  -> open "Ask SMR for access" requests, and live grants.
 * POST -> { action: "grant", email | userId, tools, reason, endsAt?, requestId? }
 *         { action: "revoke", grantId }
 *         { action: "decline", requestId }
 * Nothing here sends email.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const { adminListPremium, isMissingTable } = await import("@crucible/core");
  try {
    return NextResponse.json({ data: await adminListPremium(guard.userId) });
  } catch (e) {
    if (isMissingTable(e)) {
      return NextResponse.json({ data: { requests: [], grants: [] }, notReady: true });
    }
    throw e;
  }
}

export async function POST(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const core = await import("@crucible/core");

  if (body.action === "revoke") {
    if (typeof body.grantId !== "string" || !UUID.test(body.grantId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const done = await core.adminRevokeGrant(guard.userId, body.grantId);
    return NextResponse.json({ ok: done });
  }

  if (body.action === "decline") {
    if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const done = await core.adminDeclineRequest(guard.userId, body.requestId);
    return NextResponse.json({ ok: done });
  }

  if (body.action === "grant") {
    let userId = body.userId;
    if (typeof userId !== "string" && typeof body.email === "string") {
      const found = await core.adminFindUserByEmail(body.email);
      if (!found) return NextResponse.json({ error: "No account uses that email." }, { status: 404 });
      userId = found.id;
    }
    const checked = core.checkGrantInput({ ...body, userId });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const row = await core.adminGrantPremium(guard.userId, checked.value);
    return NextResponse.json({ ok: true, id: row.id });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
