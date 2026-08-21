/**
 * GET /api/cron/purge-tablet-sessions
 *
 * Vercel cron, daily: hard-deletes Mini Forge tablet_session rows that are no
 * longer needed, so sensitive kiosk intake/output (forge_intake / forge_output)
 * does not sit in the database indefinitely. Previously expires_at was only a
 * read filter -- expired rows were invisible but never removed. This is the
 * missing purge path.
 *
 * Deletes a row when EITHER:
 *   - it is past its hard expiry (expires_at < now), or
 *   - it was claimed (imported to an account) more than 30 days ago -- the data
 *     already lives on the user's account, so the tablet copy is redundant.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed -- if
 * CRON_SECRET is not configured, the route rejects everything rather than
 * becoming publicly callable. Same pattern as the other cron routes. Schedule
 * lives in vercel.json.
 */
import { NextResponse } from "next/server";
import { query } from "@crucible/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const purged = await query<{ id: string }>(
      `DELETE FROM tablet_session
        WHERE expires_at < NOW()
           OR (claimed_at IS NOT NULL AND claimed_at < NOW() - INTERVAL '30 days')
        RETURNING id`
    );
    return NextResponse.json({
      ok: true,
      purged: purged.length,
      checked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/purge-tablet-sessions] failed:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "tablet session purge failed" },
      { status: 500 }
    );
  }
}
