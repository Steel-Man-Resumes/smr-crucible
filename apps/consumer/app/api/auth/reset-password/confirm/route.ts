import crypto from "crypto";
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { isValidEmail } from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 30_000) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const { email, token, password } = await request.json();
    const normalizedEmail = String(email || "").toLowerCase().trim();
    const rawToken = String(token || "");
    const newPassword = String(password || "");

    if (!isValidEmail(normalizedEmail) || !rawToken) {
      return NextResponse.json(
        { error: "This reset link is invalid." },
        { status: 400 }
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const identifier = `password-reset:${normalizedEmail}`;
    const tokenHash = hashToken(rawToken);
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tokenRow = await client.query(
        `SELECT token FROM verification_token
         WHERE identifier = $1 AND token = $2 AND expires > NOW()
         FOR UPDATE`,
        [identifier, tokenHash]
      );
      if (tokenRow.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "This reset link is invalid or expired." },
          { status: 400 }
        );
      }

      const update = await client.query(
        `UPDATE users
         SET password_hash = $1, "emailVerified" = COALESCE("emailVerified", NOW())
         WHERE email = $2
         RETURNING id`,
        [passwordHash, normalizedEmail]
      );
      await client.query(`DELETE FROM verification_token WHERE identifier = $1`, [
        identifier,
      ]);
      await client.query("COMMIT");

      if (update.rows.length === 0) {
        return NextResponse.json(
          { error: "Account not found." },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Password reset confirm error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not reset password." },
      { status: 500 }
    );
  }
}
