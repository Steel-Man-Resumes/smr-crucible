/**
 * POST /api/auth/claim-reset
 *
 * F3 first-proof choice, "I didn't set this". An email-link or Google sign-in
 * landed on an account whose address was never proven and that has a password
 * or two-step. The person says they did not set it: in one transaction the
 * password and two-step are removed, every other session is signed out, the
 * address is marked proven and the choice is recorded (lib/email-proof.ts
 * wipeUnprovenCredentials). A notice goes to the inbox. The page then calls
 * update(); the jwt callback re-reads the account (no two-step left, address
 * proven) and lets the session in.
 *
 * Only a session that signed in through the inbox and still owes the choice
 * (claim "2fa" or "password", set server-side at sign-in) can call it, and it
 * changes nothing on an account whose address is already proven.
 */
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { markEmailProven, proofSourceFor, wipeUnprovenCredentials } from "@/lib/email-proof";
import { runAfterResponse } from "@/lib/session-registry";
import { buildCredentialsClearedEmail, sendSecurityEmail } from "@/lib/security-email";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const claim = (session?.user as any)?.claim;
  if (claim !== "2fa" && claim !== "password") {
    return NextResponse.json({ error: "There is nothing to remove on this sign-in." }, { status: 400 });
  }

  const client = await pool.connect();
  let outcome: "wiped" | "already-proven";
  try {
    outcome = await wipeUnprovenCredentials(client, {
      userId,
      keepSid: ((session?.user as any)?.sid as string | undefined) || null,
      userAgent: req.headers.get("user-agent") || null,
    });
    // The person proved the inbox with this sign-in: record how (079, M2).
    if (outcome === "wiped") await markEmailProven(client, userId, proofSourceFor((session?.user as any)?.via));
  } finally {
    client.release();
  }

  if (outcome === "wiped" && session?.user?.email) {
    const to = session.user.email;
    const origin = new URL(req.url).origin;
    runAfterResponse(() => sendSecurityEmail(to, buildCredentialsClearedEmail({ origin })));
  }
  return NextResponse.json({ ok: true, outcome });
}
