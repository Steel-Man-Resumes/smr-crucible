/**
 * POST /api/auth/register
 *
 * Creates a new user account with email + password.
 * For first-time users arriving from Forge who want to
 * create an account without the magic link friction.
 */

import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const trimmedEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      // Check if user already exists
      const existing = await client.query(
        `SELECT id FROM users WHERE email = $1`,
        [trimmedEmail]
      );

      if (existing.rows.length > 0) {
        return NextResponse.json(
          { error: "An account with this email already exists. Try signing in instead." },
          { status: 409 }
        );
      }

      // Create user with password
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await client.query(
        `INSERT INTO users (name, email, "emailVerified", password_hash)
         VALUES ($1, $2, NOW(), $3)
         RETURNING id, email`,
        [trimmedEmail.split("@")[0], trimmedEmail, passwordHash]
      );

      return NextResponse.json({
        success: true,
        email: result.rows[0].email,
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Registration error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 }
    );
  }
}
