import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import {
  checkAuthRateLimit,
  getClientIp,
  isValidEmail,
  normalizeSignInEmail,
  precheckRateLimits,
  refundAuthRateLimits,
} from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Pre-flight for the login form: verify email+password and report whether a
 * second step (2FA) is needed, so the UI knows to show the code field. The
 * actual sign-in still enforces 2FA independently in authorize() -- this is
 * UX, not the security boundary.
 *
 * Per email it spends the password sign-in's own counter (F10): it used to
 * have none, so a spread-out attack could test one account here without
 * limit. Per IP it has its own, looser counter, so a room of people behind one
 * address (a lab, a library) is not refused after a few sign-ins: each
 * sign-in spends the password per-IP budget once, at the real sign-in.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const body = await req.json().catch(() => ({}));
  const email = normalizeSignInEmail(typeof body?.email === "string" ? body.email : "");
  const password = String(body?.password || "");
  const limits = precheckRateLimits(ip, email);

  const tooMany = () =>
    NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );

  // Counts FAILED checks only: a correct password hands both counts back.
  const ipCheck = await checkAuthRateLimit(limits.ip.key, limits.ip.config);
  if (!ipCheck.allowed) return tooMany();
  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ ok: false });
  }
  const emailCheck = await checkAuthRateLimit(limits.email.key, limits.email.config);
  if (!emailCheck.allowed) {
    await refundAuthRateLimits([ipCheck.ticket]);
    return tooMany();
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
    await refundAuthRateLimits([ipCheck.ticket, emailCheck.ticket]);
    return NextResponse.json({
      ok: true,
      twoFactorRequired: !!r.rows[0].two_factor_enabled,
    });
  } finally {
    client.release();
  }
}
