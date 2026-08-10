/**
 * GET /api/cron/deletion-retry
 *
 * Vercel cron, every 30 minutes: drains pending deletion_task rows
 * (migration 037) -- primarily R2 object deletes enqueued by
 * /api/user/delete-data when a user's secure_object rows are cleaned up.
 * DB rows are deleted synchronously in delete-data; the R2 side is queued
 * here so a transient R2 failure can't leave the request hanging or drop
 * the cleanup silently. Schedule lives in vercel.json.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed --
 * if CRON_SECRET is not configured, the route rejects everything rather
 * than becoming publicly callable. Same pattern as
 * apps/consumer/app/api/cron/voice-reconcile/route.ts.
 */
import { NextResponse } from "next/server";
import { runDeletionTasks } from "@crucible/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDeletionTasks(50);
    return NextResponse.json({
      ok: true,
      ...result,
      checked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/deletion-retry] failed:", err?.message || err);
    return NextResponse.json({ ok: false, error: "deletion retry failed" }, { status: 500 });
  }
}
