/**
 * POST /api/auth/register
 *
 * Creates a new user account with email + password. For first-time users
 * arriving from the Forge who want an account without the magic-link friction.
 *
 * Also carries the handoff that localStorage cannot: the anonymous Forge session
 * (forgeOutput/resume/narrative) and the user's contact info (name + phone) are
 * persisted server-side at creation, so the user lands in the Refinery with
 * their work intact and profile complete -- not on a locked dashboard. The
 * forge_session lives in forge.* localStorage and is lost crossing to the authed
 * refinery.* origin, so the relay in the dashboard layout never sees it.
 */

import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { query, getOne } from "@crucible/core";
import { persistForgeSession } from "@/lib/forge-persist";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_500_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { email, password, name, phone, forge } = await request.json();

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

    const cName = typeof name === "string" ? name.trim() : "";
    const cPhone = typeof phone === "string" ? phone.trim() : "";

    let newUserId = "";
    const client = await pool.connect();
    try {
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

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await client.query(
        `INSERT INTO users (name, email, "emailVerified", password_hash)
         VALUES ($1, $2, NOW(), $3)
         RETURNING id, email`,
        [cName || trimmedEmail.split("@")[0], trimmedEmail, passwordHash]
      );
      newUserId = result.rows[0].id;
    } finally {
      client.release();
    }

    // Best-effort: carry the anonymous Forge work onto the new account. Must run
    // BEFORE the contact upsert so the contact merge reads (and preserves) the
    // profile_data that saveForgeSession writes.
    if (
      forge &&
      typeof forge === "object" &&
      (forge.forgeOutput || forge.resumeText)
    ) {
      try {
        await persistForgeSession(newUserId, forge);
      } catch (e: any) {
        console.error("[register] forge persist failed:", e?.message || e);
      }
    }

    // Best-effort: persist contact so the user lands profile-complete (name +
    // phone are the unlock gate) instead of bouncing to a locked Settings step.
    if (cName || cPhone) {
      try {
        const contact = {
          name: cName,
          phone: cPhone,
          email: trimmedEmail,
          city: "",
          state: "",
        };
        const existingProfile = await getOne<{ profile_data: Record<string, any> }>(
          `SELECT profile_data FROM consumer_profile WHERE user_id = $1`,
          [newUserId]
        );
        if (existingProfile) {
          const profileData = { ...(existingProfile.profile_data || {}), contact };
          await query(
            `UPDATE consumer_profile SET profile_data = $1, updated_at = now() WHERE user_id = $2`,
            [JSON.stringify(profileData), newUserId]
          );
        } else {
          await query(
            `INSERT INTO consumer_profile (user_id, profile_data) VALUES ($1, $2)`,
            [newUserId, JSON.stringify({ contact })]
          );
        }
        if (cName) {
          await query(`UPDATE users SET name = $1 WHERE id = $2`, [cName, newUserId]);
        }
      } catch (e: any) {
        console.error("[register] contact persist failed:", e?.message || e);
      }
    }

    return NextResponse.json({ success: true, email: trimmedEmail });
  } catch (err: any) {
    console.error("Registration error:", err?.message || err);
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 }
    );
  }
}
