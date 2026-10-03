/**
 * POST /api/auth/claim-password  { password }
 *
 * F3 first-proof choice, password case. An email-link or Google sign-in landed
 * on an account whose address was never proven and that has a password (no
 * two-step). The session carries claim "password" and the middleware holds it
 * at /login/verify. The right password shows this person set it AND has the
 * inbox: the address is marked proven and the password stays. The page then
 * calls update(); the jwt callback clears the claim only after re-reading
 * email_proven_at.
 *
 * Rate limited on the step-up counters (per signed-in user and per IP), so it
 * is never a free password oracle. Node runtime (bcrypt).
 */
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { markEmailProven } from "@/lib/email-proof";
import {
  checkAuthRateLimits,
  getClientIp,
  refundAuthRateLimits,
  stepUpRateLimits,
} from "@/lib/auth-rate-limit";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if ((session?.user as any)?.claim !== "password") {
    return NextResponse.json({ error: "There is nothing to confirm on this sign-in." }, { status: 400 });
  }

  const limit = await checkAuthRateLimits(stepUpRateLimits(getClientIp(req), userId));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": Math.ceil(limit.resetIn / 1000).toString() } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Enter the password on this account." }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    const hash: string | null = r.rows[0]?.password_hash ?? null;
    // Nothing left to keep (removed meanwhile): just settle the choice.
    if (!hash) {
      await markEmailProven(client, userId);
      return NextResponse.json({ ok: true });
    }
    if (!(await bcrypt.compare(password, hash))) {
      return NextResponse.json(
        { error: "That password didn't match. Try again, or choose the other option below." },
        { status: 400 }
      );
    }
    await markEmailProven(client, userId);
    await refundAuthRateLimits(limit.tickets); // only wrong passwords count
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }
}
