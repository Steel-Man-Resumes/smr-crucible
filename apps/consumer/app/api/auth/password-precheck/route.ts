import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import {
  checkAuthRateLimit,
  getClientIp,
  AUTH_LIMITS,
  isValidEmail,
} from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Pre-flight for the login form: verify email+password and report whether a
 * second step (2FA) is needed, so the UI knows to show the code field. The
 * actual sign-in still enforces 2FA independently in authorize() -- this is
 * UX, not the security boundary. No password oracle beyond what the login
 * callback already is; still rate-limited per IP.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = checkAuthRateLimit(`precheck:${ip}`, AUTH_LIMITS.passwordPerIp);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").toLowerCase().trim();
  const password = String(body?.password || "");
  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ ok: false });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT password_hash, two_factor_enabled FROM users WHERE email = $1`,
      [email]
    );
    if (r.rowCount === 0 || !r.rows[0].password_hash) {
      return NextResponse.json({ ok: false });
    }
    const ok = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!ok) return NextResponse.json({ ok: false });
    return NextResponse.json({
      ok: true,
      twoFactorRequired: !!r.rows[0].two_factor_enabled,
    });
  } finally {
    client.release();
  }
}
