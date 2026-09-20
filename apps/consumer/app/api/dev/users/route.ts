/**
 * GET /api/dev/users?q=... -- admin directory of user accounts for the
 * view-as / assist pickers. Metadata + progress signals + AI cost only,
 * never content.
 */

import { NextResponse } from "next/server";
import { query } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export async function GET(request: Request) {
  // Was reading tier off the SESSION TOKEN, which a stale session can
  // still assert after a demotion. The guard reads it from the database.
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const users = await query(
    `SELECT u.id, u.name, u.email, u.tier, u.current_stage, u.created_at,
            (SELECT MAX(atu.created_at) FROM ai_token_usage atu WHERE atu.user_id = u.id) AS last_ai_at,
            COALESCE((SELECT SUM(atu.cost_usd) FROM ai_token_usage atu WHERE atu.user_id = u.id), 0)::numeric(12,4) AS ai_cost_usd,
            (SELECT COUNT(*) FROM job_application ja WHERE ja.user_id = u.id)::int AS applications,
            NULL::text AS joined_via
       FROM users u
      WHERE ($1 = '' OR LOWER(COALESCE(u.email,'')) LIKE '%' || $1 || '%'
                    OR LOWER(COALESCE(u.name,''))  LIKE '%' || $1 || '%')
      ORDER BY u.created_at DESC
      LIMIT 100`,
    [q]
  );

  // "Joined via" was a subquery on access_code_redemption, which is row-level
  // protected: unscoped it reads NULL for every user and the column just looks
  // empty. Ask each org, scoped to it, which of these people are its members;
  // earliest redemption wins, as before.
  const list = users as { id: string; joined_via: string | null }[];
  if (list.length > 0) {
    const { runPerOrg } = await import("@crucible/core");
    const orgs = await query<{ id: string; code: string }>(`SELECT id, code FROM access_code`);
    const members = await runPerOrg<{ user_id: string; redeemed_at: string }>(
      orgs.map((o) => o.id),
      guard.userId,
      `SELECT user_id, redeemed_at FROM access_code_redemption
        WHERE access_code_id = $1 AND user_id = ANY($2::uuid[])`,
      (orgId) => [orgId, list.map((u) => u.id)]
    );
    const first = new Map<string, { code: string; at: number }>();
    for (const o of orgs) {
      for (const m of members.get(o.id) ?? []) {
        const at = new Date(m.redeemed_at).getTime();
        const prior = first.get(m.user_id);
        if (!prior || at < prior.at) first.set(m.user_id, { code: o.code, at });
      }
    }
    for (const u of list) u.joined_via = first.get(u.id)?.code ?? null;
  }

  return NextResponse.json({ users });
}
