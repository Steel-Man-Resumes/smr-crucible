import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { verifyToken } from "@/lib/two-factor";

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
      `SELECT u.two_factor_enabled, u.password_hash, tf.secret, tf.backup_codes
         FROM users u
         LEFT JOIN user_two_factor tf ON tf.user_id = u.id
        WHERE u.id = $1`,
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
    let verified = false;
    if (token && row.secret && verifyToken(token, row.secret)) verified = true;
    if (!verified && token && Array.isArray(row.backup_codes)) {
      for (const h of row.backup_codes as string[]) {
        if (await bcrypt.compare(token.replace(/\s/g, ""), h)) {
          verified = true;
          break;
        }
      }
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

    await client.query(`DELETE FROM user_two_factor WHERE user_id = $1`, [session.user.id]);
    await client.query(`UPDATE users SET two_factor_enabled = false WHERE id = $1`, [
      session.user.id,
    ]);
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
