import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { matchTotpStep, generateBackupCodes, resolveTotpSecret } from "@/lib/two-factor";
import { consumeTotpStep } from "@/lib/second-factor";
import { revokeUserSessions } from "@/lib/session-registry";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Confirm 2FA: verify a code against the pending secret, turn it on, and
 *  return one-time backup codes (shown once; stored hashed). */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT secret, secret_iv, secret_tag, secret_key_version FROM user_two_factor WHERE user_id = $1`,
      [session.user.id]
    );
    if (r.rowCount === 0) {
      return NextResponse.json(
        { error: "Start setup first, then enter the code." },
        { status: 400 }
      );
    }
    const pendingSecret = resolveTotpSecret(r.rows[0], session.user.id);
    const step = matchTotpStep(token, pendingSecret);
    if (step === null) {
      return NextResponse.json(
        { error: "That code didn't match. Check your authenticator app and try again." },
        { status: 400 }
      );
    }
    // Record the step (F10) so the code typed here cannot be replayed to sign
    // in during the next minute or so.
    if (!(await consumeTotpStep(client, session.user.id, step))) {
      return NextResponse.json(
        { error: "That code was already used. Wait for the next code and try again." },
        { status: 400 }
      );
    }

    const codes = generateBackupCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    // Turning two-step on signs out every other session in the same step, so
    // a session opened before the second factor existed cannot ride past it.
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE user_two_factor SET backup_codes = $2::jsonb, confirmed_at = now(), updated_at = now()
         WHERE user_id = $1`,
        [session.user.id, JSON.stringify(hashes)]
      );
      await client.query(`UPDATE users SET two_factor_enabled = true WHERE id = $1`, [
        session.user.id,
      ]);
      await revokeUserSessions(client, {
        userId: session.user.id,
        keepSid: ((session.user as any).sid as string | undefined) || null,
        userAgent: req.headers.get("user-agent") || null,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
    await client
      .query(
        `INSERT INTO user_login_event (user_id, event, user_agent) VALUES ($1, 'two_factor_enabled', $2)`,
        [session.user.id, req.headers.get("user-agent") || null]
      )
      .catch(() => {});

    return NextResponse.json({ success: true, backupCodes: codes });
  } finally {
    client.release();
  }
}
