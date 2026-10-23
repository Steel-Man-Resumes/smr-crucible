/**
 * Admin: support requests / Help & Feedback inbox (Phase 8.3/8.6).
 *
 * GET   -> filtered list (status, category), joined to user names.
 *          ?digest=1 -> the on-demand text digest (no email, no cron).
 * POST  -> one of:
 *            { id, status }      status transition (received|seen|read|fixed|replied|closed)
 *            { id, reply }       write a reply (surfaces in the user's Help center)
 * Admin tier only.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export const maxDuration = 10;

// Local requireAdmin deleted: it was a second, separately-maintained copy
// of the same check. One shared guard is the point.

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const adminId = guard.userId;

  const url = new URL(request.url);
  const {
    adminListSupportRequests,
    buildSupportDigest,
  } = await import("@crucible/core");

  if (url.searchParams.get("digest") === "1") {
    const digest = await buildSupportDigest();
    return NextResponse.json({ digest });
  }

  const status = url.searchParams.get("status") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const rows = await adminListSupportRequests({ status, category, limit: 200 });
  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const adminId = guard.userId;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const {
    setSupportStatus,
    replyToSupportRequest,
    isValidSupportStatus,
    isIdeaStage,
    updateIdeaProgress,
  } = await import("@crucible/core");

  if (body.ideaStage !== undefined) {
    if (!isIdeaStage(body.ideaStage) || typeof body.update !== "string" || !body.update.trim() || body.update.length > 2000) {
      return NextResponse.json({ error: "Choose an idea stage and write an update for its author." }, { status: 400 });
    }
    const ok = await updateIdeaProgress(id, body.ideaStage, body.update);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  // Reply path.
  if (typeof body.reply === "string" && body.reply.trim()) {
    const reply = body.reply.trim().slice(0, 4000);
    await replyToSupportRequest(id, reply);
    return NextResponse.json({ ok: true });
  }

  // Status-transition path.
  const status = String(body.status || "");
  if (!isValidSupportStatus(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const ok = await setSupportStatus(id, status);
  return NextResponse.json({ ok, ...(!ok ? { error: "Use idea progress with an update for ideas." } : {}) }, { status: ok ? 200 : 409 });
}
