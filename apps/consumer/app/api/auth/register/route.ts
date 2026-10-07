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
 * Forge run lives in forge.* localStorage and is lost crossing to the authed
 * refinery.* origin, so the relay in the dashboard layout never sees it.
 *
 * The Forge run is saved ONLY when the body also says `saveForgeRun: true`
 * (the person answered "Yes" to a required yes/no). On a shared computer the
 * run in the browser may be someone else's (lib/forge-carry.ts).
 */

import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { query, ensureUserAttribution, queryAsUser, getOneAsUser } from "@crucible/core";
import { persistForgeSession } from "@/lib/forge-persist";
import { forgeRunToPersist, MAX_REGISTER_BODY_BYTES } from "@/lib/forge-carry";
import { passwordProblem } from "@/lib/password-policy";
import {
  checkAuthRateLimit,
  getClientIp,
  AUTH_LIMITS,
} from "@/lib/auth-rate-limit";

/** Read the org access code the user entered with (set as a cookie by /access). */
function accessCodeFromCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const m = cookie.match(/(?:^|;\s*)smr_access_code=([A-Za-z0-9]{4,20})(?:;|$)/);
  return m ? m[1].toUpperCase() : null;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Version of the Terms/Privacy/AI-processing notice the user accepts at
// registration. Bump when that notice materially changes so the immutable
// consent-event history records which version each account agreed to.
const TERMS_VERSION = "2026-08-21-v1";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_REGISTER_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    // Measure what actually arrived: a chunked request has no content-length.
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REGISTER_BODY_BYTES) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const { email, password, name, phone, turnstileToken, acceptedTerms } = body;

    // Shared-computer rule: a Forge run is saved only with an explicit yes.
    const forgeRun = forgeRunToPersist(body);
    if (!forgeRun.ok) {
      return NextResponse.json(
        { error: "The resume on this computer is too large to save to a new account. Choose No to create your account without it." },
        { status: 413 }
      );
    }

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

    // Product-level consent gate: no account, profile, or Forge data is persisted
    // without an explicit, versioned Terms/Privacy/AI-processing acceptance. The
    // client sends acceptedTerms:true only when the box is checked; a direct API
    // caller must send it too, so acceptance is enforced server-side, not just in
    // the UI.
    if (acceptedTerms !== true) {
      return NextResponse.json(
        { error: "You must accept the Terms and Privacy Policy to create an account." },
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

    // Abuse limiting -- generous on purpose (see AUTH_LIMITS.registerPerIp):
    // a whole room signing up at once must pass; a bot flood must not.
    const ip = getClientIp(request);
    const ipCheck = await checkAuthRateLimit(
      `register:ip:${ip}`,
      AUTH_LIMITS.registerPerIp
    );
    const emailCheck = await checkAuthRateLimit(
      `register:email:${trimmedEmail}`,
      AUTH_LIMITS.registerPerEmail
    );
    if (!ipCheck.allowed || !emailCheck.allowed) {
      return NextResponse.json(
        { error: "Too many signups from this connection right now. Wait a minute and try again. Your spot is not lost." },
        { status: 429 }
      );
    }

    const problem = passwordProblem(password);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
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
        // SECURITY (account-takeover fix): this public form NEVER claims or
        // verifies an existing account. A pre-provisioned org-invite account
        // (no password, no emailVerified, no OAuth) could previously be claimed
        // here by anyone who merely knew the email -- setting a password and
        // marking it verified without any proof of controlling that address.
        //
        // The real invitee already has a proof-of-ownership path: the invite
        // email carries a 7-day magic link that signs them straight in, and a
        // lost link is re-issued from /login ("Email me a sign-in link").
        // Existing active accounts sign in with their password or that same
        // magic link. So any existing email stops here.
        return NextResponse.json(
          {
            error:
              'An account with this email already exists. If your organization set it up, open the sign-in link in your invite email. You can also go to the sign-in page and choose "Email me a sign-in link." If it is already your account, just sign in.',
          },
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

    // Record the versioned Terms/Privacy/AI-processing acceptance: the mutable
    // current-state row (consumer_consent 'core') plus the immutable history row
    // (consumer_consent_event) that compliance trusts. Best-effort: the hard gate
    // above already blocked signup without acceptance, so a lost audit row is
    // logged, never a reason to fail an account the user is waiting on.
    if (newUserId) {
      try {
        await query(
          `INSERT INTO consumer_consent
             (user_id, consent_layer, status, consent_text_version, collection_context)
           VALUES ($1, 'core', 'granted', $2, $3)
           ON CONFLICT (user_id, consent_layer)
           DO UPDATE SET status = 'granted', granted_at = now(),
                         consent_text_version = $2, collection_context = $3`,
          [newUserId, TERMS_VERSION, JSON.stringify({ via: "registration", terms: true, privacy: true, ai_processing: true })]
        );
        await query(
          `INSERT INTO consumer_consent_event
             (user_id, consent_layer, action, text_version, collection_method, context)
           VALUES ($1, 'core', 'granted', $2, 'registration', $3)`,
          [newUserId, TERMS_VERSION, JSON.stringify({ terms: true, privacy: true, ai_processing: true })]
        );
      } catch (e: any) {
        console.error("[register] consent record failed:", e?.code || e?.name || "error");
      }
    }

    // Best-effort: carry the anonymous Forge work onto the new account, only
    // when the person answered "Yes" (forgeRunToPersist above). Must run
    // BEFORE the contact upsert so the contact merge reads (and preserves) the
    // profile_data that saveForgeSession writes. Never log the run or an error
    // message that could quote it.
    if (forgeRun.run) {
      try {
        await persistForgeSession(newUserId, forgeRun.run);
      } catch (e: any) {
        console.error("[register] forge persist failed:", e?.code || e?.name || "error");
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
        const existingProfile = await getOneAsUser<{ profile_data: Record<string, any> }>(newUserId, 
          `SELECT profile_data FROM consumer_profile WHERE user_id = $1`,
          [newUserId]
        );
        if (existingProfile) {
          const profileData = { ...(existingProfile.profile_data || {}), contact };
          await queryAsUser(newUserId, 
            `UPDATE consumer_profile SET profile_data = $1, updated_at = now() WHERE user_id = $2`,
            [JSON.stringify(profileData), newUserId]
          );
        } else {
          await queryAsUser(newUserId, 
            `INSERT INTO consumer_profile (user_id, profile_data) VALUES ($1, $2)`,
            [newUserId, JSON.stringify({ contact })]
          );
        }
        if (cName) {
          await query(`UPDATE users SET name = $1 WHERE id = $2`, [cName, newUserId]);
        }
      } catch (e: any) {
        console.error("[register] contact persist failed:", e?.code || e?.name || "error");
      }
    }

    // Partner tracking: bind this new account to the org whose code it arrived
    // with, so funder/compliance data collects from day one (best-effort).
    const orgCode = accessCodeFromCookie(request);
    if (orgCode && newUserId) {
      try {
        await ensureUserAttribution(newUserId, orgCode);
      } catch (e: any) {
        console.error("[register] org attribution failed:", e?.code || e?.name || "error");
      }
    }

    // userId lets the form mark a run the person said "Yes" to as theirs, so
    // the Refinery does not ask about it again.
    return NextResponse.json({ success: true, email: trimmedEmail, userId: newUserId });
  } catch (err: any) {
    // Name or code only: a JSON.parse error quotes the raw body (passwords,
    // record answers).
    console.error("Registration error:", err?.code || err?.name || "error");
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 }
    );
  }
}
