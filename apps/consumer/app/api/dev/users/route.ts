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
            (SELECT ac.code FROM access_code_redemption acr
               JOIN access_code ac ON ac.id = acr.access_code_id
              WHERE acr.user_id = u.id
              ORDER BY acr.redeemed_at ASC LIMIT 1) AS joined_via
       FROM users u
      WHERE ($1 = '' OR LOWER(COALESCE(u.email,'')) LIKE '%' || $1 || '%'
                    OR LOWER(COALESCE(u.name,''))  LIKE '%' || $1 || '%')
      ORDER BY u.created_at DESC
      LIMIT 100`,
    [q]
  );

  return NextResponse.json({ users });
}
