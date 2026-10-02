import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import {
  checkAuthRateLimit,
  getClientIp,
  isValidEmail,
  normalizeSignInEmail,
  signInRateLimits,
} from "@/lib/auth-rate-limit";

/** The precheck spends the password sign-in's own counters. */
const PASSWORD_CALLBACK_PATH = "/api/auth/callback/password-login";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Pre-flight for the login form: verify email+password and report whether a
 * second step (2FA) is needed, so the UI knows to show the code field. The
 * actual sign-in still enforces 2FA independently in authorize() -- this is
 * UX, not the security boundary.
 *
 * Limited by the SAME counters as the password sign-in itself (per IP and per
 * email, F10). It used to have its own per-IP counter and no per-email one,
 * which doubled the password guesses an IP got and let a spread-out attack
 * test one account without limit here.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => ({}));
  const email = normalizeSignInEmail(typeof body?.email === "string" ? body.email : "");
  const password = String(body?.password || "");
  const limits = signInRateLimits(PASSWORD_CALLBACK_PATH, ip, email);

  const tooMany = () =>
    NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );

  if (!checkAuthRateLimit(limits.ip.key, limits.ip.config).allowed) return tooMany();
  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ ok: false });
  }
  if (!checkAuthRateLimit(limits.email.key, limits.email.config).allowed) return tooMany();

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
