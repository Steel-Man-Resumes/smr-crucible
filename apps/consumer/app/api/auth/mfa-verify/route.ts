/**
 * POST /api/auth/mfa-verify  { code }
 *
 * The second step after an email-link or Google sign-in into an account with
 * two-step verification (F1). The session arrives with mfa: false and the
 * middleware lets it reach nothing else. This route checks the code exactly
 * the way password sign-in does (lib/second-factor.ts: same replay guard, same
 * backup-code handling) under the password sign-in's own rate-limit counters,
 * then records the success on THIS session's row (user_session.mfa_verified_at).
 *
 * It does not change the token itself. The page then calls update(), and the
 * jwt callback flips the claim only after re-reading that row, so nothing the
 * client sends can mark a session verified.
 *
 * Node runtime (bcrypt). Needs migration 067 (user_session.mfa_verified_at).
 */
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { verifySecondFactor } from "@/lib/second-factor";
import {
  checkAuthRateLimits,
  getClientIp,
  signInRateLimits,
} from "@/lib/auth-rate-limit";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Spends the password sign-in's counters: a code guess here is a sign-in guess. */
const PASSWORD_CALLBACK_PATH = "/api/auth/callback/password-login";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session?.user as any)?.sid as string | undefined;
  if (!userId || !sid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const email = (session?.user?.email || "").toLowerCase().trim();
  const limits = signInRateLimits(PASSWORD_CALLBACK_PATH, getClientIp(req), email || userId);
  const limit = await checkAuthRateLimits([
    { key: limits.ip.key, config: limits.ip.config },
    { key: limits.email.key, config: limits.email.config },
  ]);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": Math.ceil(limit.resetIn / 1000).toString() } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) {
    return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await verifySecondFactor(client, userId, code);
    if (!result.ok) {
      const error =
        result.reason === "replay"
          ? "That code was already used. Wait for the next code and try again."
          : result.reason === "not-enrolled"
            ? "Two-step verification is not set up on this account. Sign out and sign in again."
            : "That code didn't match. Try again, or use a backup code.";
      return NextResponse.json({ error }, { status: 400 });
    }

    // Record the second step on this session's row. An older session that
    // never registered a row gets one here.
    const upd = await client.query(
      `INSERT INTO user_session (jti, user_id, created_at, last_seen_at, mfa_verified_at)
       VALUES ($1, $2, now(), now(), now())
       ON CONFLICT (jti) DO UPDATE SET mfa_verified_at = now(), last_seen_at = now()
        WHERE user_session.user_id = EXCLUDED.user_id AND user_session.revoked_at IS NULL`,
      [sid, userId]
    );
    if ((upd.rowCount ?? 0) !== 1) {
      return NextResponse.json({ error: "This session has ended. Sign in again." }, { status: 401 });
    }
    return NextResponse.json({ ok: true, method: result.method });
  } finally {
    client.release();
  }
}
