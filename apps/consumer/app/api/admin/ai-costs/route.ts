/**
 * GET /api/admin/ai-costs -- per-user AI cost calculator (admin only).
 *
 * Exact token accounting from ai_token_usage (real provider-reported counts).
 * Returns per-user aggregates for the requested window (default 30 days) plus
 * a per-endpoint breakdown and grand totals.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserTier, query } from "@crucible/core";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const tier = await getUserTier(session.user.id);
  if (tier !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(
    365,
    Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30)
  );

  try {
    const perUser = await query(
      `SELECT u.id AS user_id,
              COALESCE(u.name, '') AS name,
              COALESCE(u.email, '(pre-auth / anonymous)') AS email,
              COUNT(*)::int AS calls,
              SUM(t.input_tokens)::bigint AS input_tokens,
              SUM(t.output_tokens)::bigint AS output_tokens,
              SUM(t.cost_usd)::numeric(12,4) AS cost_usd
         FROM ai_token_usage t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.created_at > NOW() - ($1 || ' days')::interval
        GROUP BY u.id, u.name, u.email
        ORDER BY SUM(t.cost_usd) DESC
        LIMIT 200`,
      [String(days)]
    );

    const perEndpoint = await query(
      `SELECT endpoint,
              COUNT(*)::int AS calls,
              SUM(input_tokens)::bigint AS input_tokens,
              SUM(output_tokens)::bigint AS output_tokens,
              SUM(cost_usd)::numeric(12,4) AS cost_usd
         FROM ai_token_usage
        WHERE created_at > NOW() - ($1 || ' days')::interval
        GROUP BY endpoint
        ORDER BY SUM(cost_usd) DESC`,
      [String(days)]
    );

    const totals = await query(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(SUM(cost_usd), 0)::numeric(12,4) AS cost_usd
         FROM ai_token_usage
        WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );

    return NextResponse.json({
      days,
      totals: totals[0],
      perUser: perUser,
      perEndpoint: perEndpoint,
    });
  } catch (err: any) {
    console.error("ai-costs query failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
