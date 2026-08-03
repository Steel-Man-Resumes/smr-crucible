/**
 * GET /api/user/ai-costs -- the signed-in user's OWN AI usage and cost.
 *
 * Exact token accounting (real provider-reported counts). Not prominent by
 * design: surfaced in Settings, available to solo users; sponsored users'
 * costs are additionally visible to their sponsoring org (org view ships with
 * the partner dashboard build-out).
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { query } from "@crucible/core";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(
    365,
    Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30)
  );

  try {
    const totals = await query(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(SUM(cost_usd), 0)::numeric(12,4) AS cost_usd
         FROM ai_token_usage
        WHERE user_id = $1
          AND created_at > NOW() - ($2 || ' days')::interval`,
      [session.user.id, String(days)]
    );

    const perEndpoint = await query(
      `SELECT endpoint,
              COUNT(*)::int AS calls,
              SUM(cost_usd)::numeric(12,4) AS cost_usd
         FROM ai_token_usage
        WHERE user_id = $1
          AND created_at > NOW() - ($2 || ' days')::interval
        GROUP BY endpoint
        ORDER BY SUM(cost_usd) DESC`,
      [session.user.id, String(days)]
    );

    return NextResponse.json({
      days,
      totals: totals[0],
      perEndpoint: perEndpoint,
    });
  } catch (err: any) {
    console.error("user ai-costs query failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
