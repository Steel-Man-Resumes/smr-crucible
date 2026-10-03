/**
 * GET /api/cron/purge-auth-rate-limits
 *
 * Vercel cron, daily: deletes auth_rate_limit counter rows older than a day.
 * The longest auth window is an hour and the limiter reads only the current
 * and previous window, so nothing that enforces a limit is lost. See
 * purgeOldAuthRateLimits in apps/consumer/lib/auth-rate-limit.ts.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed --
 * if CRON_SECRET is not configured, the route rejects everything. Same pattern
 * as the other cron routes. Schedule lives in vercel.json.
 */
import { NextResponse } from "next/server";
import { purgeOldAuthRateLimits } from "@/lib/auth-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const purged = await purgeOldAuthRateLimits();
    return NextResponse.json({
      ok: true,
      purged,
      checked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/purge-auth-rate-limits] failed:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "auth rate limit purge failed" },
      { status: 500 }
    );
  }
}
