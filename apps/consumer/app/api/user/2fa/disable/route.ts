import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { verifySecondFactor } from "@/lib/second-factor";
import { revokeUserSessions } from "@/lib/session-registry";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Turn 2FA off -- requires proving identity again (a current code or the
 *  account password), so a hijacked live session can't quietly remove it. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  const password = typeof body?.password === "string" ? body.password : "";

  const client = await pool.connect();
  try {
    const u = await client.query(
      `SELECT two_factor_enabled, password_hash FROM users WHERE id = $1`,
      [session.user.id]
    );
    if (u.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const row = u.rows[0];
    if (!row.two_factor_enabled) {
      return NextResponse.json(
        { error: "Two-step verification is already off." },
        { status: 400 }
      );
    }

    // Accept a valid current code, a backup code, or the account password.
    // The code check is the same one sign-in uses (lib/second-factor.ts): a
    // TOTP code already used is refused, and only input shaped like a backup
    // code is checked against the bcrypt-hashed backup codes. A backup code
    // used here is consumed; the whole row is deleted a few lines down anyway.
    let verified = false;
    if (token) {
      const result = await verifySecondFactor(client, session.user.id, token);
      verified = result.ok;
    }
    if (!verified && password && row.password_hash) {
      verified = await bcrypt.compare(password, row.password_hash);
    }
    if (!verified) {
      return NextResponse.json(
        { error: "Enter a current code or your password to turn this off." },
        { status: 400 }
      );
    }

    // Turning two-step off also signs out every other session: if this is a
    // hijacked session removing the second factor, the owner's own devices
    // are not the ones that should keep running unchallenged.
    await client.query("BEGIN");
    try {
      await client.query(`DELETE FROM user_two_factor WHERE user_id = $1`, [session.user.id]);
      await client.query(`UPDATE users SET two_factor_enabled = false WHERE id = $1`, [
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
        `INSERT INTO user_login_event (user_id, event, user_agent) VALUES ($1, 'two_factor_disabled', $2)`,
        [session.user.id, req.headers.get("user-agent") || null]
      )
      .catch(() => {});

    return NextResponse.json({ success: true });
  } finally {
    client.release();
  }
}
