/**
 * POST /api/auth/mfa-verify  { code }
 *
 * The second step after an email-link or Google sign-in into an account with
 * two-step verification (F1). The session arrives with mfa: false and the
 * middleware lets it reach nothing else. This route checks the code exactly
 * the way password sign-in does (lib/second-factor.ts: same replay guard, same
 * backup-code handling) under its own per-user and per-IP counters, then
 * records the success on THIS session's row (user_session.mfa_verified_at).
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
import { markEmailProven } from "@/lib/email-proof";
import {
  checkAuthRateLimits,
  getClientIp,
  refundAuthRateLimits,
  stepUpRateLimits,
} from "@/lib/auth-rate-limit";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Postgres "undefined_column": migration 067 has not run yet. */
const UNDEFINED_COLUMN = "42703";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session?.user as any)?.sid as string | undefined;
  if (!userId || !sid) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // Own counters, keyed by the signed-in user (5 per 15 min) and the IP.
  // Not the password sign-in's per-email counter: anyone who knows the
  // address can spend that one, which would lock this person out of the
  // step-up too.
  const limit = await checkAuthRateLimits(stepUpRateLimits(getClientIp(req), userId));
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
    let upd;
    try {
      upd = await client.query(
        `INSERT INTO user_session (jti, user_id, created_at, last_seen_at, mfa_verified_at)
         VALUES ($1, $2, now(), now(), now())
         ON CONFLICT (jti) DO UPDATE SET mfa_verified_at = now(), last_seen_at = now()
          WHERE user_session.user_id = EXCLUDED.user_id AND user_session.revoked_at IS NULL`,
        [sid, userId]
      );
    } catch (err: any) {
      if (err?.code === UNDEFINED_COLUMN) {
        console.error("[mfa-verify] user_session.mfa_verified_at missing (migration 067 not applied)");
        return NextResponse.json(
          { error: "This step is not available right now. Sign out, then sign in with your password and code." },
          { status: 503 }
        );
      }
      throw err;
    }
    if ((upd.rowCount ?? 0) !== 1) {
      return NextResponse.json({ error: "This session has ended. Sign in again." }, { status: 401 });
    }
    // F3: on an account whose address was never proven, a correct code after
    // an email-link or Google sign-in shows this person set up the two-step
    // AND has the inbox, so the address is now proven and everything stays.
    if ((session?.user as any)?.claim === "2fa") {
      await markEmailProven(client, userId);
    }
    // Only failed codes count toward the 5 per 15 minutes.
    await refundAuthRateLimits(limit.tickets);
    return NextResponse.json({ ok: true, method: result.method });
  } finally {
    client.release();
  }
}
