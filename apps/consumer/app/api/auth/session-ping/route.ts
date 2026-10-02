import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { getClientIp } from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Refresh this session's row in the active-devices list: last-seen time, and
 * device/place when the row has none yet. Called once on dashboard mount;
 * idempotent.
 *
 * The row is created server-side at sign-in (F5, lib/session-registry.ts), so
 * this is no longer what makes a session revocable. It still inserts a row for
 * an older session signed in before that change, so those become listable and
 * revocable the first time they load the dashboard.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const jti = (session?.user as any)?.sid as string | undefined; // stored in user_session.jti
  if (!userId || !jti) return NextResponse.json({ ok: false }, { status: 401 });

  const ua = req.headers.get("user-agent") || null;
  const ip = getClientIp(req);
  const city = req.headers.get("x-vercel-ip-city") || null;
  const country = req.headers.get("x-vercel-ip-country") || null;
  const location = [city, country].filter(Boolean).join(", ") || null;

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_session (jti, user_id, user_agent, ip, approx_location, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (jti) DO UPDATE
         SET last_seen_at = now(),
             user_agent = COALESCE(user_session.user_agent, EXCLUDED.user_agent),
             ip = COALESCE(user_session.ip, EXCLUDED.ip),
             approx_location = COALESCE(user_session.approx_location, EXCLUDED.approx_location)
       WHERE user_session.user_id = EXCLUDED.user_id`,
      [jti, userId, ua, ip, location]
    );
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}
