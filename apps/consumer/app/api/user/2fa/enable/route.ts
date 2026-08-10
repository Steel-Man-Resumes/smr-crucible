import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { verifyToken, generateBackupCodes, resolveTotpSecret } from "@/lib/two-factor";

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
    if (!verifyToken(token, pendingSecret)) {
      return NextResponse.json(
        { error: "That code didn't match. Check your authenticator app and try again." },
        { status: 400 }
      );
    }

    const codes = generateBackupCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await client.query(
      `UPDATE user_two_factor SET backup_codes = $2::jsonb, confirmed_at = now(), updated_at = now()
       WHERE user_id = $1`,
      [session.user.id, JSON.stringify(hashes)]
    );
    await client.query(`UPDATE users SET two_factor_enabled = true WHERE id = $1`, [
      session.user.id,
    ]);
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
