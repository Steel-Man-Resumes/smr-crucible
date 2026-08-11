/**
 * GET /api/user/login-events -- the signed-in user's OWN security timeline.
 *
 * Ownership-scoped: only the caller's rows from user_login_event. We return the
 * event, a coarse device label ("Chrome on Windows"), the approximate location,
 * and when. We NEVER return the raw IP address.
 *
 * This complements the active-devices list (current sessions). It is history:
 * sign-ins, two-step-verification changes, and password changes over time.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { deviceLabel } from "@/lib/security-email";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT event, user_agent, approx_location, created_at
         FROM user_login_event
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 25`,
      [userId]
    );
    const events = r.rows.map((row) => ({
      event: row.event,
      device: deviceLabel(row.user_agent),
      // approx_location only; the raw IP is never sent to the client.
      location: row.approx_location || null,
      createdAt: row.created_at,
    }));
    return NextResponse.json({ events });
  } catch (err: any) {
    console.error("user login-events query failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
