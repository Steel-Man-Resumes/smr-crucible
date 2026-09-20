/**
 * GET /api/dev/personas -- role exemplars for the Developer Switcher.
 *
 * Admin only. Returns the seeded org people (org admins first) so Troy can
 * one-click view-impersonate each role's real experience: org leader
 * (Marianne), staff (Miranda/Kelly), etc. Real accounts, blue view mode,
 * read-only at the edge.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";

export const maxDuration = 10;

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const { query } = await import("@crucible/core");

  // Only orgs that are actually live. The previous query took the first 8 rows
  // ordered by partner name across EVERY seeded org, active or not, which put
  // retired and demo partners at the top (anything starting with a digit sorts
  // first) and truncated the real ones off the bottom. `is_active` and
  // `expires_at` already carry the signal, so no schema change is needed.
  // CROSS-ORG BY DESIGN, so it has to be assembled one org at a time.
  //
  // org_staff is row-level protected and a policy scopes to a single
  // organization, so the old single unscoped query now returns nothing -- the
  // database doing exactly what it should. A platform admin legitimately needs
  // to see across orgs, and the honest way to express that is to ask for each
  // org explicitly rather than to punch a hole in the policy.
  const { runScoped } = await import("@crucible/core");
  const orgs = await query<{ id: string; partner_name: string }>(
    `SELECT id, partner_name FROM access_code
      WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())
      ORDER BY partner_name
      LIMIT 20`
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const org of orgs) {
    const staff = await runScoped<unknown[][]>(
      { orgId: org.id, userId: guard.userId, role: "org_admin" },
      (sql) => [
        sql`SELECT os.user_id AS "userId", u.name, u.email, os.role, os.title,
                   ${org.partner_name} AS "orgName"
              FROM org_staff os
              JOIN users u ON u.id = os.user_id
             WHERE os.access_code_id = ${org.id}
             ORDER BY CASE os.role WHEN 'org_admin' THEN 0 ELSE 1 END, u.name`,
      ]
    );
    rows.push(...((staff[0] ?? []) as Array<Record<string, unknown>>));
    if (rows.length >= 60) break;
  }

  return NextResponse.json({ data: rows });
}
