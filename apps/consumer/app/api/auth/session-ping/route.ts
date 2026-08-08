import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { getClientIp } from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Record this session's device against its JWT session id (jti) so it appears
 * in the active-devices list and can be revoked. Called once on dashboard mount;
 * idempotent (ON CONFLICT refreshes last_seen).
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
       ON CONFLICT (jti) DO UPDATE SET last_seen_at = now()`,
      [jti, userId, ua, ip, location]
    );
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}
