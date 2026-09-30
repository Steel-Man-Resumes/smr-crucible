/**
 * GET /api/access-name?code=<ACCESS_CODE>
 *
 * The display name for a partner access code, read from the database
 * (access_code.partner_name). The /access landing page uses it to greet the
 * organization. It used to read a hardcoded code -> name map, which published
 * every live code in this public repository.
 *
 * Returns { name } for a code that is active and not expired, { name: null }
 * for anything else. It never says WHY a code has no name, and it never returns
 * seats, tier or owner. Because a name answer does confirm a code exists, the
 * lookup is capped per IP per day in the durable ai_usage counter.
 *
 * Deliberately NOT under /api/access-code (that prefix requires a session, and
 * a partner link is opened by people who have not signed up yet).
 */

import { NextResponse } from "next/server";
import { getOne, incrementIpUsage } from "@crucible/core";
import { getClientIp } from "@/lib/auth-rate-limit";

export const dynamic = "force-dynamic";

const LOOKUPS_PER_IP_PER_DAY = 30;

export async function GET(request: Request) {
  const code = (new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(code)) {
    return NextResponse.json({ name: null });
  }

  const count = await incrementIpUsage(getClientIp(request), "access-name").catch(() => 0);
  if (count > LOOKUPS_PER_IP_PER_DAY) {
    return NextResponse.json({ name: null }, { status: 429 });
  }

  try {
    // access_code is not a row-level-security table (see RLS_PROTECTED_TABLES).
    const row = await getOne<{ partner_name: string | null }>(
      `SELECT partner_name FROM access_code
        WHERE code = $1 AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())`,
      [code]
    );
    return NextResponse.json({ name: row?.partner_name?.trim() || null });
  } catch {
    return NextResponse.json({ name: null });
  }
}
