import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { generateSecret, otpauthUrl, qrDataUrl, encryptTotpSecret } from "@/lib/two-factor";

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
    // Phase 1C: `secret` is stored as ciphertext (AES-256-GCM) going
    // forward -- see lib/two-factor.ts resolveTotpSecret for the read-side
    // shim that keeps pre-encryption rows working.
    const enc = encryptTotpSecret(secret, session.user.id);
    await client.query(
      `INSERT INTO user_two_factor
         (user_id, secret, secret_iv, secret_tag, secret_key_version, backup_codes, confirmed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, NULL, now())
       ON CONFLICT (user_id)
       DO UPDATE SET secret = $2, secret_iv = $3, secret_tag = $4, secret_key_version = $5,
                      backup_codes = '[]'::jsonb, confirmed_at = NULL, updated_at = now()`,
      [session.user.id, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion]
    );

    const account = u.rows[0].email || "account";
    const otpauth = otpauthUrl(secret, account);
    const qr = await qrDataUrl(otpauth);
    return NextResponse.json({ secret, otpauth, qr });
  } finally {
    client.release();
  }
}
