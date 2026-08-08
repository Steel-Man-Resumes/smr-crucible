import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { getClientIp } from "@/lib/auth-rate-limit";
import { deviceLabel, buildNewDeviceEmail, sendSecurityEmail } from "@/lib/security-email";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * New-device sign-in alert. Called once on dashboard mount. Fingerprints the
 * device by its User-Agent (JWT-independent, so it sidesteps the session-id
 * problem entirely). First time we see a given device for a user we record it;
 * if the user already had a DIFFERENT device on record, we email an alert.
 *
 * Idempotent: a device already on record is a no-op, so repeat page loads don't
 * re-alert or pile up rows.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const ua = req.headers.get("user-agent");
  if (!ua) return NextResponse.json({ ok: true, alerted: false }); // can't fingerprint

  const ip = getClientIp(req);
  const city = req.headers.get("x-vercel-ip-city") || null;
  const country = req.headers.get("x-vercel-ip-country") || null;
  const location = [city, country].filter(Boolean).join(", ") || null;

  const client = await pool.connect();
  try {
    // Already seen this exact device for this user? -> nothing to do.
    const seen = await client.query(
      `SELECT 1 FROM user_login_event
        WHERE user_id = $1 AND event = 'sign_in' AND user_agent = $2 LIMIT 1`,
      [userId, ua]
    );
    if ((seen.rowCount ?? 0) > 0) {
      return NextResponse.json({ ok: true, alerted: false });
    }

    // New device. Did the user already have another one on record? If so, this
    // is a genuinely new device (not their first-ever sign-in) -> alert.
    const others = await client.query(
      `SELECT COUNT(*)::int AS n FROM user_login_event
        WHERE user_id = $1 AND event = 'sign_in'`,
      [userId]
    );
    const hadOthers = (others.rows[0]?.n ?? 0) > 0;

    await client.query(
      `INSERT INTO user_login_event (user_id, event, ip, user_agent, approx_location)
       VALUES ($1, 'sign_in', $2, $3, $4)`,
      [userId, ip, ua, location]
    );

    let alerted = false;
    if (hadOthers && session?.user?.email) {
      const dryRun =
        process.env.NODE_ENV !== "production" &&
        req.headers.get("x-alert-dry-run") === "1";
      if (!dryRun) {
        try {
          const origin = new URL(req.url).origin;
          await sendSecurityEmail(
            session.user.email,
            buildNewDeviceEmail({
              name: session.user.name || null,
              device: deviceLabel(ua),
              location,
              whenISO: new Date().toISOString(),
              origin,
            })
          );
        } catch (err: any) {
          console.error("new-device alert failed:", err?.message || err);
        }
      }
      alerted = true;
    }

    return NextResponse.json({ ok: true, alerted });
  } finally {
    client.release();
  }
}
