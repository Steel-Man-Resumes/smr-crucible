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
            (SELECT COUNT(DISTINCT acr.user_id) FROM access_code_redemption acr
              WHERE acr.access_code_id = ac.id)::int AS joined
       FROM access_code ac
       LEFT JOIN users u ON u.id = ac.partner_user_id
      ORDER BY ac.partner_name, ac.code`
  );

  // One scoped count per org. A policy scopes to a single organization, so a
  // cross-org directory has to ask once per row rather than sweep the table.
  const { runScoped } = await import("@crucible/core");
  const withStaff = [];
  for (const o of orgs) {
    const r = await runScoped<unknown[][]>(
      { orgId: o.id, userId: guard.userId, role: "org_admin" },
      (sql) => [sql`SELECT COUNT(*)::int AS n FROM org_staff WHERE access_code_id = ${o.id}`]
    );
    const n = (r[0]?.[0] as { n?: number } | undefined)?.n ?? 0;
    withStaff.push({ ...o, staff_count: n });
  }

  return NextResponse.json({ orgs: withStaff });
}
