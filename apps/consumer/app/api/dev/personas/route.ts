/**
 * GET /api/dev/personas -- people the DEV menu can view as, read-only.
 *
 * Admin only (platform_admin row plus two-step). WHO IS LISTED (house lane L2,
 * fix round 1): an organization's name says nothing about who is in it (an
 * org called "(Demo)" can hold real accounts), so the line is drawn on the
 * ACCOUNT. By default only accounts whose email ends in .example.invalid,
 * which are fictional by construction (that domain can never receive mail),
 * are returned: owners, staff and participants. Real accounts' staff come
 * only with ?real=1, the menu's explicit "Show real organizations", and then
 * as name and role only, never an email. Real participants are never
 * returned; they are found on purpose in Admin > Users.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isFictionalEmail, FICTIONAL_EMAIL_SUFFIX } from "@/lib/dev-mode";

export const maxDuration = 10;

type Row = { userId: string; name: string | null; email: string | null; role?: string; title?: string | null; orgName: string };

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const { query, runScoped } = await import("@crucible/core");
  const wantReal = new URL(request.url).searchParams.get("real") === "1";

  // Only orgs that are actually live. CROSS-ORG BY DESIGN, so it is assembled
  // one org at a time: org_staff and access_code_redemption are row-level
  // protected and scoped to a single organization, and a platform admin asks
  // for each org explicitly rather than punching a hole in the policy.
  const orgs = await query<{ id: string; partner_name: string; owner_id: string | null }>(
    `SELECT id, partner_name, partner_user_id AS owner_id FROM access_code
      WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())
      ORDER BY partner_name
      LIMIT 500`
  );

  // Owners too (an owner with no org_staff row used to be invisible here).
  const ownerIds = orgs.map((o) => o.owner_id).filter((x): x is string => !!x);
  const owners = ownerIds.length
    ? await query<{ id: string; name: string | null; email: string | null }>(
        `SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`,
        [ownerIds]
      )
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  // One transaction, re-scoped per org (set_config(..., true) is
  // transaction-local; the latest value wins for the statements after it).
  // Participants: fictional accounts only, filtered IN THE QUERY, so a real
  // participant's name never leaves the database for this menu.
  const perOrg = wantReal ? 2 : 3;
  const results = orgs.length
    ? await runScoped<unknown[][]>(
        { orgId: orgs[0].id, userId: guard.userId, role: "org_admin" },
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
                         AND right(lower(u.email), ${FICTIONAL_EMAIL_SUFFIX.length}) = ${FICTIONAL_EMAIL_SUFFIX}
                       ORDER BY u.name
                       LIMIT 20`,
                ]),
          ])
      )
    : [];

  const staff: Row[] = [];
  const participants: Row[] = [];
  orgs.forEach((org, n) => {
    const owner = org.owner_id ? ownerById.get(org.owner_id) : null;
    const rows = (results[n * perOrg + 1] ?? []) as Row[];
    if (owner && !rows.some((r) => r.userId === owner.id)) {
      staff.push({ userId: owner.id, name: owner.name, email: owner.email, role: "owner", title: null, orgName: org.partner_name });
    }
    staff.push(...rows);
    if (!wantReal) participants.push(...((results[n * perOrg + 2] ?? []) as Row[]).filter((r) => isFictionalEmail(r.email)));
  });

  const fictional = staff.filter((r) => isFictionalEmail(r.email));
  const real = staff.filter((r) => !isFictionalEmail(r.email));
  if (wantReal) {
    // Name and role only. Never an email for a real person on this menu.
    return NextResponse.json({
      data: real.slice(0, 60).map((r) => ({ userId: r.userId, name: r.name, email: null, role: r.role, title: r.title ?? null, orgName: r.orgName, demo: false })),
    });
  }
  return NextResponse.json({
    data: fictional.slice(0, 60).map((r) => ({ ...r, demo: true })),
    participants: participants.slice(0, 60).map((r) => ({ ...r, demo: true })),
    // A count only: how many real staff accounts sit behind the expand.
    realCount: real.length,
  });
}
