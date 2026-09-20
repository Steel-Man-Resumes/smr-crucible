/**
 * GET /api/dev/orgs -- admin directory of every partner org (access codes)
 * with cohort stats. Powers the "View as org" picker.
 */

import { NextResponse } from "next/server";
import { query } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export async function GET() {
  // Was reading tier off the SESSION TOKEN, which a stale session can
  // still assert after a demotion. The guard reads it from the database.
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  // THE STAFF COUNT WAS ALWAYS ZERO, for every organization, silently.
  //
  // org_staff is row-level protected and this subquery ran unscoped, so it
  // returned 0 while the surrounding org and participant columns stayed
  // populated and the endpoint returned 200. Nothing looked broken; the
  // directory simply told a platform admin that nobody worked anywhere.
  // Platform-admin authentication is not database scope. (Found in review.)
  const orgs = await query<{
    id: string;
    code: string;
    partner_name: string;
    tier: string;
    is_active: boolean;
    org_logo_url: string | null;
    owner_email: string | null;
    joined: number;
  }>(
    `SELECT ac.id, ac.code, ac.partner_name, ac.tier, ac.is_active, ac.org_logo_url,
            u.email AS owner_email,
            0 AS joined
       FROM access_code ac
       LEFT JOIN users u ON u.id = ac.partner_user_id
      ORDER BY ac.partner_name, ac.code`
  );

  // Staff AND members, counted per org while scoped to that org, in one
  // transaction. Both tables are row-level protected; a policy scopes to one
  // organization, so a cross-org directory asks once per row rather than
  // sweeping the table -- and the member count had the same defect the staff
  // count once did: an unscoped subquery that reads zero for everybody.
  const { runPerOrg } = await import("@crucible/core");
  const counts = await runPerOrg<{ staff: number; joined: number }>(
    orgs.map((o) => o.id),
    guard.userId,
    `SELECT (SELECT COUNT(*)::int FROM org_staff WHERE access_code_id = $1) AS staff,
            (SELECT COUNT(DISTINCT user_id)::int FROM access_code_redemption WHERE access_code_id = $1) AS joined`,
    (orgId) => [orgId]
  );
  const withStaff = orgs.map((o) => {
    const c = counts.get(o.id)?.[0];
    return { ...o, joined: c?.joined ?? 0, staff_count: c?.staff ?? 0 };
  });

  return NextResponse.json({ orgs: withStaff });
}
