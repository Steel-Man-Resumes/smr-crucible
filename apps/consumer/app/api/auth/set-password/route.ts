import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { revokeUserSessions, runAfterResponse } from "@/lib/session-registry";
import { FRESH_SIGN_IN_SECONDS, signedInWithin } from "@/lib/session-policy";
import { buildPasswordChangedEmail, sendSecurityEmail } from "@/lib/security-email";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Length beats composition rules for real security (NIST), but a floor + one
// number keeps out the truly weak. A short blocklist stops the obvious ones.
const MIN_LEN = 10;
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "iloveyou1", "welcome123", "steelman1", "changeme1",
]);

function passwordProblem(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < MIN_LEN)
    return `Use at least ${MIN_LEN} characters.`;
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw))
    return "Include at least one letter and one number.";
  if (COMMON.has(pw.toLowerCase()))
    return "That password is too common. Pick something only you would know.";
  return null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const password = body?.password;
  const currentPassword = body?.currentPassword;

  const problem = passwordProblem(password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  let existingHashForEmail = false;
  const client = await pool.connect();
  try {
    const cur = await client.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [session.user.id]
    );
    if (cur.rowCount === 0) {
      return NextResponse.json(
        { error: "Could not save password. Please sign out and sign in again." },
        { status: 404 }
      );
    }
    const existingHash: string | null = cur.rows[0].password_hash;
    existingHashForEmail = !!existingHash;

    // Changing an existing password requires proving you know the current one --
    // a live session alone must not be able to silently rotate it.
    if (existingHash) {
      if (!currentPassword || typeof currentPassword !== "string") {
        return NextResponse.json(
          { error: "Enter your current password to change it.", needsCurrent: true },
          { status: 400 }
        );
      }
      const ok = await bcrypt.compare(currentPassword, existingHash);
      if (!ok) {
        return NextResponse.json(
          { error: "Current password is incorrect.", needsCurrent: true },
          { status: 400 }
        );
      }
      if (await bcrypt.compare(password, existingHash)) {
        return NextResponse.json(
          { error: "That is already your password. Choose a new one." },
          { status: 400 }
        );
      }
    } else {
      // Adding the FIRST password to an email-link or Google account (F6).
      // There is no current password to prove, so the proof is a fresh
      // sign-in: a session older than 10 minutes (or one from before sign-ins
      // were stamped) could be a stolen or long-forgotten one, and a password
      // would let it come back as a brand-new session.
      if (!signedInWithin((session.user as any).sit, FRESH_SIGN_IN_SECONDS)) {
        return NextResponse.json(
          {
            error:
              "For your safety, sign out and sign back in, then add your password within 10 minutes.",
            needsFreshSignIn: true,
          },
          { status: 403 }
        );
      }
    }

    const hash = await bcrypt.hash(password, 12);
    const currentSid = ((session.user as any).sid as string | undefined) || null;
    // The new password and the sign-out of every other session land together:
    // a password change that leaves a stolen session running fixes nothing.
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE users SET password_hash = $1, password_updated_at = now() WHERE id = $2`,
        [hash, session.user.id]
      );
      await revokeUserSessions(client, {
        userId: session.user.id,
        keepSid: currentSid,
        userAgent: req.headers.get("user-agent") || null,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    // Security timeline (best-effort; never block the change on logging).
    try {
      await client.query(
        `INSERT INTO user_login_event (user_id, event, user_agent)
         VALUES ($1, $2, $3)`,
        [session.user.id, existingHash ? "password_changed" : "password_created",
         req.headers.get("user-agent") || null]
      );
    } catch {
      // ignore
    }
  } finally {
    client.release();
  }

  // Tell the account's inbox (best-effort, after the response).
  const to = session.user.email;
  if (to) {
    const origin = new URL(req.url).origin;
    const name = session.user.name || null;
    const kind = existingHashForEmail ? "changed" : "created";
    runAfterResponse(() =>
      sendSecurityEmail(
        to,
        buildPasswordChangedEmail({ name, kind, whenISO: new Date().toISOString(), origin })
      )
    );
  }

  return NextResponse.json({ success: true });
}
