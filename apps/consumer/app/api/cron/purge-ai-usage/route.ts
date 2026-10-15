/**
 * GET /api/cron/purge-ai-usage
 *
 * Vercel cron, daily: deletes ai_usage counter rows older than 30 days, and
 * any per-IP row from before today that still holds a raw IP address (rows
 * written before IPs were hashed). Daily limits only read today's rows, so
 * nothing that enforces a limit is lost. See purgeOldAiUsage in
 * packages/core/src/rateLimit.ts.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed --
 * if CRON_SECRET is not configured, the route rejects everything. Same pattern
 * as the other cron routes. Schedule lives in vercel.json.
 */
import { NextResponse } from "next/server";
import { purgeOldAiUsage, query } from "@crucible/core";

/** Finished operation records older than this are deleted with the usage counters.
 * Running ones are kept (a stuck reservation is reviewed, never silently dropped). */
const AI_OPERATION_RETENTION_DAYS = 30;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const purged = await purgeOldAiUsage();
    let operations: number | "unavailable" = "unavailable";
    try {
      const rows = await query<{ id: string }>(
        `DELETE FROM ai_operation WHERE status <> 'running' AND created_at < now() - ($1 || ' days')::interval RETURNING id`,
        [String(AI_OPERATION_RETENTION_DAYS)]
      );
      operations = rows.length;
    } catch {
      // 087 not applied here yet: nothing to purge.
    }
    return NextResponse.json({
      ok: true,
      purged,
      operations,
      checked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/purge-ai-usage] failed:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "ai usage purge failed" },
      { status: 500 }
    );
  }
}
