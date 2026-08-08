import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { generateSecret, otpauthUrl, qrDataUrl } from "@/lib/two-factor";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Begin 2FA enrollment: mint a pending secret, return the QR + otpauth URI.
 *  Nothing is enabled until /enable verifies a code. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const client = await pool.connect();
  try {
    const u = await client.query(
      `SELECT email, two_factor_enabled FROM users WHERE id = $1`,
      [session.user.id]
    );
    if (u.rowCount === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (u.rows[0].two_factor_enabled) {
      return NextResponse.json(
        { error: "Two-step verification is already on." },
        { status: 400 }
      );
    }

    const secret = generateSecret();
    await client.query(
      `INSERT INTO user_two_factor (user_id, secret, backup_codes, confirmed_at, updated_at)
       VALUES ($1, $2, '[]'::jsonb, NULL, now())
       ON CONFLICT (user_id)
       DO UPDATE SET secret = $2, backup_codes = '[]'::jsonb, confirmed_at = NULL, updated_at = now()`,
      [session.user.id, secret]
    );

    const account = u.rows[0].email || "account";
    const otpauth = otpauthUrl(secret, account);
    const qr = await qrDataUrl(otpauth);
    return NextResponse.json({ secret, otpauth, qr });
  } finally {
    client.release();
  }
}
