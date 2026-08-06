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
import { query, getOne, ensureUserAttribution } from "@crucible/core";
import { persistForgeSession } from "@/lib/forge-persist";

/** Read the org access code the user entered with (set as a cookie by /access). */
function accessCodeFromCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)smr_access_code=([A-Za-z0-9]{4,20})(?:;|$)/);
  return m ? m[1].toUpperCase() : null;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_500_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { email, password, name, phone, forge, turnstileToken } =
      await request.json();

    // Bot defense -- env-gated: enforced only when TURNSTILE_SECRET_KEY is set
    // (pair with NEXT_PUBLIC_TURNSTILE_SITE_KEY on the login page widget).
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (turnstileSecret) {
      if (!turnstileToken) {
        // Soft-launch: only hard-block missing tokens once TURNSTILE_ENFORCE=1
        // (set after a human confirms the widget renders and passes). Until
        // then, log and allow -- a silently broken widget must never kill
        // real signups.
        if (process.env.TURNSTILE_ENFORCE === "1") {
          return NextResponse.json(
            { error: "Please complete the verification check." },
            { status: 400 }
          );
        }
        console.error("Turnstile token missing on signup (soft-launch: allowed)");
      }
      if (turnstileToken) {
        try {
          const verify = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                secret: turnstileSecret,
                response: turnstileToken,
              }),
            }
          );
          const outcome = await verify.json();
          if (!outcome.success) {
            return NextResponse.json(
              { error: "Verification failed. Please try again." },
              { status: 400 }
            );
          }
        } catch {
          // Verification service unreachable: fail open rather than lock out
          // real users -- Turnstile is a shield, not a gate.
          console.error("Turnstile siteverify unreachable; allowing signup");
        }
      }
    }

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

      const passwordHash = await bcrypt.hash(password, 12);

      if (existing.rows.length > 0) {
        // Org-invited (or pre-provisioned) accounts that have NEVER signed in
        // by any door may be claimed by registering: proof of control is the
        // email address, exactly as it is for a fresh registration. The
        // guarded UPDATE keeps active accounts (password, magic-link history,
        // or OAuth link) untouchable -- those still 409 to sign-in.
        const claimed = await client.query(
          `UPDATE users u
              SET password_hash = $2,
                  "emailVerified" = NOW(),
                  name = COALESCE(NULLIF($3, ''), u.name)
            WHERE u.id = $1
              AND u.password_hash IS NULL
              AND u."emailVerified" IS NULL
              AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id)
            RETURNING id`,
          [existing.rows[0].id, passwordHash, cName]
        );
        if (claimed.rows.length === 0) {
          return NextResponse.json(
            { error: "An account with this email already exists. Try signing in instead." },
            { status: 409 }
          );
        }
        newUserId = claimed.rows[0].id;
      } else {
        const result = await client.query(
          `INSERT INTO users (name, email, "emailVerified", password_hash)
           VALUES ($1, $2, NOW(), $3)
           RETURNING id, email`,
          [cName || trimmedEmail.split("@")[0], trimmedEmail, passwordHash]
        );
        newUserId = result.rows[0].id;
      }
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

    // Partner tracking: bind this new account to the org whose code it arrived
    // with, so funder/compliance data collects from day one (best-effort).
    const orgCode = accessCodeFromCookie(request);
    if (orgCode && newUserId) {
      try {
        await ensureUserAttribution(newUserId, orgCode);
      } catch (e: any) {
        console.error("[register] org attribution failed:", e?.message || e);
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
