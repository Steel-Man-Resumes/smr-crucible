/**
 * GET /api/dev/personas -- role exemplars for the Developer Switcher.
 *
 * Admin only. Returns demo organizations' people (owner, org leaders, staff,
 * and participants) so an admin can one-click view each role's real
 * experience, read-only. Real organizations' staff only with ?real=1; real
 * participants never. Blue view mode, read-only at the edge and at every
 * org route.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isDemoOrgName } from "@/lib/dev-mode";

export const maxDuration = 10;

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const { query } = await import("@crucible/core");
  // REAL ORGANIZATIONS' PEOPLE ARE NOT SENT UNLESS ASKED (house lane L2, A1
  // defect H8). The DEV menu is opened on shared screens; by default it gets
  // demo organizations only, plus a count of the real ones. ?real=1 (the
  // menu's explicit "Show real organizations") returns the real staff, and
  // never real participants: a real participant is viewed only by searching
  // for them in Admin > Users, on purpose.
  const wantReal = new URL(request.url).searchParams.get("real") === "1";

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
  // NO LIMIT BEFORE WE KNOW WHO HAS STAFF. This used to take the first 20 codes
  // alphabetically and only then look for staff, so enough staffless partner
  // codes sorting early would push a real organization off the list -- and
  // which ones have staff cannot be asked up front, because that is the
  // protected table. The cap is on rows returned, applied after.
  const allOrgs = await query<{ id: string; partner_name: string; owner_id: string | null }>(
    `SELECT id, partner_name, partner_user_id AS owner_id FROM access_code
      WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())
      ORDER BY partner_name
      LIMIT 500`
  );
  const realOrgCount = allOrgs.filter((o) => !isDemoOrgName(o.partner_name)).length;
  const orgs = allOrgs.filter((o) => (wantReal ? !isDemoOrgName(o.partner_name) : isDemoOrgName(o.partner_name)));

  // Owners too (A1: an owner with no org_staff row was invisible here).
  const ownerIds = orgs.map((o) => o.owner_id).filter((x): x is string => !!x);
  const owners = ownerIds.length
    ? await query<{ id: string; name: string | null; email: string | null }>(
        `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
        [ownerIds]
      )
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  // One transaction, re-scoped per org. set_config(..., true) is
  // transaction-local and the latest value wins, so each SELECT runs under the
  // org set immediately before it. One round trip instead of one per org.
  // Participants are read for demo organizations only.
  const staffRows: Array<Record<string, unknown>> = [];
  const participantRows: Array<Record<string, unknown>> = [];
  if (orgs.length) {
    const first = orgs[0];
    const perOrg = wantReal ? 2 : 3;
    const results = await runScoped<unknown[][]>(
      { orgId: first.id, userId: guard.userId, role: "org_admin" },
      (sql) =>
        orgs.flatMap((org) => [
          sql`SELECT set_config('app.org_id', ${org.id}, true)`,
          sql`SELECT os.user_id AS "userId", u.name, u.email, os.role, os.title,
                     ${org.partner_name} AS "orgName"
                FROM org_staff os
                JOIN users u ON u.id = os.user_id
               WHERE os.access_code_id = ${org.id}
               ORDER BY CASE os.role WHEN 'org_admin' THEN 0 ELSE 1 END, u.name`,
          ...(wantReal
            ? []
            : [
                sql`SELECT r.user_id AS "userId", u.name, u.email, ${org.partner_name} AS "orgName"
                      FROM access_code_redemption r
                      JOIN users u ON u.id = r.user_id
                     WHERE r.access_code_id = ${org.id}
                     ORDER BY u.name
                     LIMIT 20`,
              ]),
        ])
    );
    orgs.forEach((org, n) => {
      const owner = org.owner_id ? ownerById.get(org.owner_id) : null;
      const staff = (results[n * perOrg + 1] ?? []) as Array<Record<string, unknown>>;
      if (owner && !staff.some((r) => r.userId === owner.id)) {
        staffRows.push({ userId: owner.id, name: owner.name, email: owner.email, role: "owner", title: null, orgName: org.partner_name });
      }
      staffRows.push(...staff);
      if (!wantReal) participantRows.push(...((results[n * perOrg + 2] ?? []) as Array<Record<string, unknown>>));
    });
  }
  const demo = !wantReal;
  return NextResponse.json({
    data: staffRows.slice(0, 60).map((r) => ({ ...r, demo })),
    participants: participantRows.slice(0, 60).map((r) => ({ ...r, demo: true })),
    realOrgCount,
  });
}
