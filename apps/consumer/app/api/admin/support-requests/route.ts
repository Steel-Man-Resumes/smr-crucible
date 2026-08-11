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
import { auth } from "@/auth";

export const maxDuration = 10;

async function requireAdmin() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { getOne } = await import("@crucible/core");
  const row = await getOne<{ tier: string }>(
    `SELECT tier FROM users WHERE id = $1`,
    [userId]
  );
  return row?.tier === "admin" ? userId : null;
}

export async function GET(request: Request) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const {
    setSupportStatus,
    replyToSupportRequest,
    isValidSupportStatus,
  } = await import("@crucible/core");

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
  await setSupportStatus(id, status);
  return NextResponse.json({ ok: true });
}
