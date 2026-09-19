/**
 * GET /api/dev/personas -- role exemplars for the Developer Switcher.
 *
 * Admin only. Returns the seeded org people (org admins first) so Troy can
 * one-click view-impersonate each role's real experience: org leader
 * (Marianne), staff (Miranda/Kelly), etc. Real accounts, blue view mode,
 * read-only at the edge.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { getOne, query } = await import("@crucible/core");
  const me = await getOne<{ tier: string }>(
    `SELECT tier FROM users WHERE id = $1`,
    [userId]
  );
  if (me?.tier !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only orgs that are actually live. The previous query took the first 8 rows
  // ordered by partner name across EVERY seeded org, active or not, which put
  // retired and demo partners at the top (anything starting with a digit sorts
  // first) and truncated the real ones off the bottom. `is_active` and
  // `expires_at` already carry the signal, so no schema change is needed.
  const rows = await query(
    `SELECT os.user_id AS "userId", u.name, u.email, os.role, os.title,
            ac.partner_name AS "orgName"
       FROM org_staff os
       JOIN users u ON u.id = os.user_id
       JOIN access_code ac ON ac.id = os.access_code_id
      WHERE ac.is_active = true
        AND (ac.expires_at IS NULL OR ac.expires_at > now())
      ORDER BY ac.partner_name,
               CASE os.role WHEN 'org_admin' THEN 0 ELSE 1 END,
               u.name
      LIMIT 60`
  );

  return NextResponse.json({ data: rows });
}
