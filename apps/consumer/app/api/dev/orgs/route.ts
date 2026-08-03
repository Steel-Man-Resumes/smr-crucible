/**
 * GET /api/dev/orgs -- admin directory of every partner org (access codes)
 * with cohort stats. Powers the "View as org" picker.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@crucible/core";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as any).tier !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const orgs = await query(
    `SELECT ac.id, ac.code, ac.partner_name, ac.tier, ac.is_active, ac.org_logo_url,
            u.email AS owner_email,
            (SELECT COUNT(DISTINCT acr.user_id) FROM access_code_redemption acr
              WHERE acr.access_code_id = ac.id)::int AS joined,
            (SELECT COUNT(*) FROM org_staff os WHERE os.access_code_id = ac.id)::int AS staff_count
       FROM access_code ac
       LEFT JOIN users u ON u.id = ac.partner_user_id
      ORDER BY ac.partner_name, ac.code`
  );

  return NextResponse.json({ orgs });
}
