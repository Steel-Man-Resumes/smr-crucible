import crypto from "crypto";
import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import {
  AUTH_LIMITS,
  checkAuthRateLimit,
  getClientIp,
  isValidEmail,
} from "@/lib/auth-rate-limit";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const RESET_TTL_MINUTES = 60;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetEmail(resetUrl: string): { subject: string; html: string; text: string } {
  const subject = "Reset your Steel Man Resumes password";
  const text = `Use this link to reset your password. It expires in ${RESET_TTL_MINUTES} minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">Reset your password</h1>
      <p>Use the button below to set a new Steel Man Resumes password. This link expires in ${RESET_TTL_MINUTES} minutes.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Reset password</a>
      </p>
      <p style="font-size:13px;color:#666">If the button does not work, copy and paste this link:</p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${resetUrl}</p>
      <p style="font-size:13px;color:#666">If you did not request this, you can ignore this email.</p>
    </div>
  `;
  return { subject, html, text };
}

export async function POST(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 20_000) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const { email } = await request.json();
    const normalizedEmail = String(email || "").toLowerCase().trim();
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const ipCheck = checkAuthRateLimit(
      `password-reset:ip:${ip}`,
      AUTH_LIMITS.magicLinkPerIp
    );
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: "Too many reset attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(ipCheck.resetIn / 1000).toString(),
          },
        }
      );
    }

    const emailCheck = checkAuthRateLimit(
      `password-reset:email:${normalizedEmail}`,
      AUTH_LIMITS.magicLinkPerEmail
    );
    if (!emailCheck.allowed) {
      return NextResponse.json(
        { error: "Too many reset attempts for this email. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(emailCheck.resetIn / 1000).toString(),
          },
        }
      );
    }

    const client = await pool.connect();
    try {
      const existing = await client.query(
        `SELECT id FROM users WHERE email = $1`,
        [normalizedEmail]
      );

      // Do not reveal whether an account exists.
      if (existing.rows.length === 0) {
        return NextResponse.json({ success: true });
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);
      const identifier = `password-reset:${normalizedEmail}`;
      const resetUrl = new URL("/reset-password", request.url);
      resetUrl.searchParams.set("email", normalizedEmail);
      resetUrl.searchParams.set("token", rawToken);

      await client.query("BEGIN");
      await client.query(`DELETE FROM verification_token WHERE identifier = $1`, [
        identifier,
      ]);
      await client.query(
        `INSERT INTO verification_token (identifier, token, expires)
         VALUES ($1, $2, NOW() + ($3::text || ' minutes')::interval)`,
        [identifier, tokenHash, String(RESET_TTL_MINUTES)]
      );
      await client.query("COMMIT");

      const resendKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.error("Password reset email not sent: AUTH_RESEND_KEY missing");
        return NextResponse.json({ success: true });
      }

      const emailContent = buildResetEmail(resetUrl.toString());
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:
            process.env.AUTH_EMAIL_FROM ||
            "Steel Man Resumes <noreply@steelmanresumes.com>",
          to: normalizedEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        }),
      });

      if (!emailRes.ok) {
        const text = await emailRes.text();
        console.error("Password reset email failed:", emailRes.status, text.slice(0, 500));
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Password reset request error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not request password reset." },
      { status: 500 }
    );
  }
}
