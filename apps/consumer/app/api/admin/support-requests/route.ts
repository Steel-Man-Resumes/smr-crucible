/**
 * Admin: support requests ("Message Troy" escalations).
 *
 * GET  -> latest 100 requests with user names
 * POST -> { id, status } status change (new | read | replied | closed)
 * Admin tier only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 10;

const VALID_STATUSES = ["new", "read", "replied", "closed"];

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

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { query } = await import("@crucible/core");
  const rows = await query(
    `SELECT sr.id, sr.email, sr.message, sr.thread_excerpt, sr.page, sr.status,
            sr.created_at, u.name AS user_name
       FROM support_request sr
       LEFT JOIN users u ON u.id = sr.user_id
      ORDER BY sr.created_at DESC
      LIMIT 100`
  );
  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { query } = await import("@crucible/core");
  await query(`UPDATE support_request SET status = $2 WHERE id = $1`, [id, status]);
  return NextResponse.json({ ok: true });
}
