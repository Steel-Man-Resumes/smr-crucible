import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool, neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import {
  MFA_VERIFY_PAGE,
  SESSION_REGISTRY_CUTOFF,
  SESSIONS_REVOKED_EVENT,
  adminSecondFactorOk,
  authRouteSkipsSessionChecks,
  isAdminPowerPath,
  nowSeconds,
  pendingSessionTreatment,
  sessionPending,
  revocationVerdict,
  sessionRowRequired,
  forgeGateVerdict,
  termsGateVerdict,
  termsCurrent,
  revocationCheck,
} from "@/lib/session-policy";
import { CONSENT_LOOKUP_SQL, TERMS_PAGE, TERMS_VERSION, termsNeedsReread } from "@/lib/terms";
import {
  FORGE_SIGN_IN_REQUIRED_MESSAGE,
  forgeSignInUrl,
  forgeWallState,
  isForgeSignInPage,
} from "@/lib/forge-access";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Edge-safe HTTP query (works in the middleware `authorized` callback) for the
// per-request session-revocation check. Fail-open on any error so a DB blip can
// never lock everyone out.
// no-store: this is the session-revocation check. Next patches fetch and can
// cache an identical query; a cached "session is valid" would outlive a revoke.
const sqlEdge = neon(process.env.DATABASE_URL!, { fetchOptions: { cache: "no-store" } });

/**
 * Revocation check (3B, F5). A session with a row is revoked when its row says
 * so. A session signed in by the server-side registry (`sit` claim) with no row
 * is refused. An older token with no row is refused only once its user has
 * swept their sessions since the registry cutoff. See lib/session-policy.ts.
 * Exported for routes the middleware does not cover (Mini Forge import).
 */
export async function isSessionRevoked(
  sid: string,
  userId: string | undefined,
  signedInAt: unknown
): Promise<boolean> {
  try {
    const rows = (await sqlEdge`SELECT revoked_at FROM user_session WHERE jti = ${sid} LIMIT 1`) as any[];
    const row = rows[0] ? { revoked: rows[0].revoked_at != null } : null;
    let swept: boolean | null = null;
    if (!row && !sessionRowRequired(signedInAt) && userId) {
      const s = (await sqlEdge`
        SELECT 1 FROM user_login_event
         WHERE user_id = ${userId}::uuid AND event = ${SESSIONS_REVOKED_EVENT}
           AND created_at >= ${SESSION_REGISTRY_CUTOFF}::timestamptz
         LIMIT 1`) as any[];
      swept = s.length > 0;
    }
    return revocationVerdict({ row, signedInAt, sweptSinceCutoff: swept });
  } catch {
    return false;
  }
}

function newSessionId(sub: string): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${sub}-${Date.now()}`;
  }
}

const isDev = process.env.NODE_ENV === "development";

/**
 * Emails that receive partner tier automatically on sign-in (no code required),
 * and the org code each is bound to for funder/compliance attribution.
 *
 * CONFIGURED, NOT HARDCODED. This list used to be a literal in this file, which
 * meant a real person's email address was published in a public repo, next to
 * the fact that signing in with it grants elevated access. Both halves of that
 * are wrong: the address is personal data, and an authorization grant that
 * anyone can read is an invitation.
 *
 * Format: PARTNER_PRE_AUTH="email:CODE,email2:CODE2". A bare email with no code
 * still elevates, it just records no attribution. Unset means nobody is
 * pre-authorized, which is the correct default -- pre-authorization is an
 * exception granted per engagement, not a standing state of the software.
 */
const { PARTNER_PRE_AUTH, PARTNER_PRE_AUTH_CODE } = (() => {
  const emails: string[] = [];
  const codes: Record<string, string> = {};
  for (const entry of (process.env.PARTNER_PRE_AUTH ?? "").split(",")) {
    const [rawEmail, rawCode] = entry.split(":");
    const email = rawEmail?.trim().toLowerCase();
    if (!email) continue;
    emails.push(email);
    if (rawCode?.trim()) codes[email] = rawCode.trim();
  }
  return { PARTNER_PRE_AUTH: emails, PARTNER_PRE_AUTH_CODE: codes };
})();

const providers: any[] = [
  // Google OAuth -- env-gated, dark until AUTH_GOOGLE_ID/SECRET exist.
  // Email linking to an existing same-email account is allowed: Google verifies
  // emails, and this audience frequently loses passwords -- a second sign-in
  // door to the SAME account beats a duplicate-account support mess.
  // Limited in the signIn callback (F2): only when Google says the address is
  // verified, and never into an account that already has a password or
  // two-step verification unless that Google identity is already linked.
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : []),

  Resend({
    apiKey: process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY,
    from:
      process.env.AUTH_EMAIL_FROM ||
      "Steel Man Resumes <noreply@steelmanresumes.com>",
    // The emailed link opens /login/finish, a page with a "Finish signing in"
    // button, instead of signing in on arrival: mail scanners open links but
    // do not press buttons. See lib/sign-in-link.ts.
    async sendVerificationRequest(params: any) {
      const { sendSignInLinkEmail } = await import("@/lib/sign-in-link");
      await sendSignInLinkEmail(params);
    },
  }),

  // Password login — available in all environments
  Credentials({
    id: "password-login",
    name: "Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      totp: { label: "Code", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const email = (credentials.email as string).toLowerCase().trim();
      const password = credentials.password as string;

      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, name, email, image, tier, password_hash, two_factor_enabled FROM users WHERE email = $1`,
          [email]
        );
        if (result.rows.length === 0) return null;

        const user = result.rows[0];
        if (!user.password_hash) return null; // No password set — must use magic link

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        // Second factor: if enabled, a valid TOTP code (or a one-time backup
        // code) is required. This is the real gate -- the login form's precheck
        // is only UX. Backup codes are consumed on use; a TOTP code is refused
        // if its time step was already used (replay guard, F10). The check is
        // shared with the step-up route and 2FA disable (lib/second-factor.ts).
        if (user.two_factor_enabled) {
          const totp = String((credentials as any)?.totp || "").replace(/\s/g, "");
          if (!totp) return null;
          const { verifySecondFactor } = await import("@/lib/second-factor");
          const result = await verifySecondFactor(client, user.id, totp);
          if (!result.ok) return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          tier: user.tier,
        };
      } finally {
        client.release();
      }
    },
  }),
];

// Dev-only: skip-email login for local testing
if (isDev) {
  const DEV_TIERS = new Set(["client", "partner", "observer", "admin", "unlimited"]);
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login",
      credentials: {
        email: { label: "Email", type: "email" },
        tier: { label: "Tier", type: "text" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "dev@test.com")
          .toLowerCase()
          .trim();
        const requestedTier = String(credentials?.tier || "client").trim();
        const tier = DEV_TIERS.has(requestedTier) ? requestedTier : "client";
        const client = await pool.connect();
        try {
          let result = await client.query(
            `SELECT id, name, email, "emailVerified", image, tier FROM users WHERE email = $1`,
            [email]
          );
          if (result.rows.length === 0) {
            result = await client.query(
              `INSERT INTO users (name, email, "emailVerified", tier)
               VALUES ($1, $2, NOW(), $3)
               RETURNING id, name, email, "emailVerified", image, tier`,
              [email.split("@")[0], email, tier]
            );
          } else if (result.rows[0].tier !== tier) {
            result = await client.query(
              `UPDATE users SET tier = $2 WHERE email = $1
               RETURNING id, name, email, "emailVerified", image, tier`,
              [email, tier]
            );
          }
          const user = result.rows[0];
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            tier: user.tier,
          };
        } finally {
          client.release();
        }
      },
    })
  );
}

const isProduction = process.env.NODE_ENV === "production";
// The shared-domain session cookie only works on steelmanresumes.com hosts. On a
// Vercel Preview (*.vercel.app) the browser drops it and sign-in silently fails,
// so it is limited to the Production deployment.
const useSharedDomainCookie = isProduction && process.env.VERCEL_ENV === "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool as any),
  providers,
  // JWT strategy required for Credentials provider in NextAuth 5
  session: {
    strategy: "jwt",
  },
  // Share session cookie across all .steelmanresumes.com subdomains
  // so the marketing site can detect auth state
  ...(useSharedDomainCookie && {
    cookies: {
      sessionToken: {
        name: "authjs.session-token",
        options: {
          httpOnly: true,
          sameSite: "lax" as const,
          path: "/",
          secure: true,
          domain: ".steelmanresumes.com",
        },
      },
    },
  }),
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  callbacks: {
    // Runs before a session exists, only in the /api/auth route (Node). Return
    // true to continue, or a URL to send the person to instead.
    async signIn({ account, profile }) {
      // F2: Google must say it verified the address. An unverified Google
      // address proves nothing about the inbox, so it is refused. A verified
      // one is treated like an email link (F1 step-up, F3 first-proof choice;
      // see the jwt callback), and still auto-links by email as designed.
      //
      // B1: and it may only reach the account with that same address. A
      // browser already signed in may use Google only for its own address and
      // only from a live session (Auth.js would link Google to whatever the
      // browser is signed into, and never checks revocation); a Google
      // identity linked to an account with another address is refused. See
      // googleSignInDecision.
      if (account?.provider === "google") {
        const guards = await import("@/lib/sign-in-guards");
        if (!guards.googleEmailVerified(profile)) return guards.SIGN_IN_REFUSED.googleEmailUnverified;
        const linked = await guards.linkedAccountEmail(pool, String(account.providerAccountId ?? ""));
        // Never throws; with no session cookie it does not read anything.
        const current = await guards.readCurrentSessionForLink({
          hasSessionCookie: async () => {
            const { cookies } = await import("next/headers");
            return (await cookies()).getAll().some((c) => guards.isSessionCookieName(c.name));
          },
          getSession: () => auth(),
          isRevoked: (sid, userId, sit) => isSessionRevoked(sid, userId, sit),
          isPending: (u) => sessionPending(u as any),
        });
        return guards.googleSignInGate({ profile, linkedAccountEmail: linked, current });
      }
      return true;
    },
    async authorized({ request, auth: session }) {
      const path = request.nextUrl.pathname;
      const isApi = path.startsWith("/api/");
      const isDashboard = path.startsWith("/dashboard");
      // The Forge wall (lib/forge-access.ts): once it is up, the Forge question
      // and build screens and their API calls need a signed-in session. The
      // public pages, the free checker and the Mini Forge are never matched here.
      const wallUp = forgeWallState() === "up";
      const isForgeScreen = wallUp && isForgeSignInPage(path);
      const gate = forgeGateVerdict(path, !!session, wallUp);
      // Before the wall these screens are open to everyone, exactly as when the
      // middleware did not match them at all: no hold, no redirect (S1).
      if (gate === "open") return true;

      // Dashboard pages: redirect to login if not authenticated
      if (isDashboard && !session) {
        return Response.redirect(new URL("/login", request.url));
      }

      // A Forge screen, signed out: sign in, then straight back to this page.
      // Only the path and query of THIS request are carried, so the return
      // address is always on this site (the login page checks it again).
      if (gate === "sign-in") {
        return Response.redirect(new URL(forgeSignInUrl(path + request.nextUrl.search), request.url));
      }

      // A walled Forge API route, signed out: 401, never a redirect.
      if (gate === "refuse") {
        return Response.json(
          { error: FORGE_SIGN_IN_REQUIRED_MESSAGE, signInRequired: true },
          { status: 401 }
        );
      }

      // Protected API routes: return 401 (don't redirect)
      if (isApi && !session) {
        const protectedPrefixes = [
          "/api/dashboard", "/api/artifacts", "/api/access-code",
          "/api/disclosure-guide", "/api/interview-practice", "/api/interview-voice",
          "/api/job-search", "/api/resources-search",
          "/api/usage", "/api/user/",
        ];
        // Exact match: /api/resume-generate is authed, but the middleware
        // matcher now covers all of /api/* and /api/resume-generate-full is a
        // pre-auth Forge route -- a prefix test would wrongly catch it.
        if (
          protectedPrefixes.some((p) => path.startsWith(p)) ||
          path === "/api/resume-generate"
        ) {
          return Response.json({ error: "Not authenticated" }, { status: 401 });
        }
      }

      // Device revocation (3B): a signed-in request whose session was revoked
      // from the active-devices list is turned away here -- the real gate for
      // every page + data call. Custom /api/auth/* routes (set-password,
      // session-ping) are checked too (F6): set-password used to be exempt, so
      // a revoked session could mint a password and sign in fresh. Only
      // NextAuth's own actions (which keep /api/auth/session polling off the
      // DB) and the pre-sign-in routes skip it; see authRouteSkipsSessionChecks.
      const sid = (session?.user as any)?.sid as string | undefined;
      // L2: the signed-out allowlist is checked in the middleware instead, where
      // a revoked session is served as signed out (revocationCheck).
      if (session && sid && (isDashboard || isForgeScreen || isApi) && revocationCheck(path) === "here") {
        if (await isSessionRevoked(sid, session.user?.id, (session.user as any)?.sit)) {
          if (isApi) {
            return Response.json({ error: "Session revoked" }, { status: 401 });
          }
          return Response.redirect(
            new URL(isForgeScreen ? forgeSignInUrl(path + request.nextUrl.search) : "/login", request.url)
          );
        }
      }

      // Second step (F1): a session that signed in by email link or Google
      // into a two-step account reaches nothing but the step-up until the code
      // is entered. Pages go to the code page; API calls get 401.
      // F3: the same hold covers the first-proof choice (claim).
      // S1: the Forge routes that work signed out are not held; the middleware
      // serves them to a pending session as signed out (session-policy.ts).
      if (session && pendingSessionTreatment(path, session.user as any, wallUp) === "hold") {
        if (isApi) {
          const passwordOwed = (session.user as any)?.claim === "password";
          return Response.json(
            {
              error: passwordOwed
                ? "Confirm your password to finish signing in."
                : "Enter your two-step code to finish signing in.",
              mfaRequired: true,
            },
            { status: 401 }
          );
        }
        const verify = new URL(MFA_VERIFY_PAGE, request.url);
        verify.searchParams.set("callbackUrl", path + request.nextUrl.search);
        return Response.redirect(verify);
      }

      // Terms (security review 3a r1, M4): once the wall is up, an account that
      // has not accepted the Terms, Privacy Policy and AI-processing notice
      // (email-link and Google accounts never saw the sign-up checkbox) does it
      // once, on a one-tap page, before any Forge screen or Forge API.
      if (session) {
        const terms = termsGateVerdict(path, wallUp, termsCurrent(session.user as any, TERMS_VERSION));
        if (terms === "api") {
          return Response.json(
            { error: "Accept the terms to keep going. It takes one tap.", termsRequired: true },
            { status: 401 }
          );
        }
        if (terms === "page") {
          const page = new URL(TERMS_PAGE, request.url);
          page.searchParams.set("callbackUrl", path + request.nextUrl.search);
          return Response.redirect(page);
        }
      }

      // Admin powers (admin tools, impersonation) need a session that
      // presented a second factor. This replaces the client-only "admin needs
      // 2FA" redirect as the real gate; the banner in RefineryShell stays as
      // the explanation. requirePlatformAdmin and effectiveAuth check the same.
      if (session && isAdminPowerPath(path) && !adminSecondFactorOk(session.user as any)) {
        if (isApi) {
          return Response.json(
            {
              error:
                "Admin tools need two-step verification on this sign-in. Turn it on in Settings, or sign in again with your code.",
              secondFactorRequired: true,
            },
            { status: 403 }
          );
        }
        return Response.redirect(new URL("/dashboard/settings", request.url));
      }

      return true;
    },
    async jwt({ token, user, trigger, account, profile }) {
      // On sign-in or when user object is available, persist tier
      if (user) {
        token.tier = (user as any).tier || "client";
      }
      // On magic link sign-in, user object may not have tier — fetch it
      if (trigger === "signIn" && !token.tier) {
        try {
          const client = await pool.connect();
          try {
            const result = await client.query(
              `SELECT tier FROM users WHERE id = $1`,
              [token.sub]
            );
            token.tier = result.rows[0]?.tier || "client";
          } finally {
            client.release();
          }
        } catch {
          token.tier = "client";
        }
      }
      // Pre-authorized emails: auto-elevate to partner tier on sign-in
      if (trigger === "signIn" && token.email) {
        const email = (token.email as string).toLowerCase();
        if (PARTNER_PRE_AUTH.includes(email)) {
          const tierPriority: Record<string, number> = { admin: 0, unlimited: 1, partner: 1, client: 2, observer: 3 };
          const current = tierPriority[token.tier as string] ?? 3;
          if (current > 1) {
            token.tier = "partner";
            if (token.sub) {
              const orgCode = PARTNER_PRE_AUTH_CODE[email] || null;
              pool.connect().then(async (c) => {
                try {
                  await c.query(
                    `UPDATE users SET tier = 'partner' WHERE id = $1 AND tier NOT IN ('admin', 'unlimited', 'partner')`,
                    [token.sub]
                  );
                  // Attribute to the org (first code wins) for tracking.
                  //
                  // Through smr_redeem_code, the one membership path: this used
                  // to INSERT the row itself, and the app role no longer can.
                  // Core is not imported here because this file is also bundled
                  // for the edge middleware; the function is called directly.
                  // app.user_id is set so the person can read their OWN
                  // memberships under row-level security -- without it the
                  // first-code-wins check sees nothing and always re-binds.
                  if (orgCode) {
                    await c.query("BEGIN");
                    try {
                      await c.query(`SELECT set_config('app.user_id', $1, true)`, [token.sub]);
                      // rls-lint-ok(access_code_redemption): same pooled client, inside BEGIN, after set_config('app.user_id') just above
                      const has = await c.query(
                        `SELECT 1 FROM access_code_redemption WHERE user_id = $1 LIMIT 1`,
                        [token.sub]
                      );
                      if (has.rowCount === 0) {
                        await c.query(`SELECT smr_redeem_code($1::uuid, $2)`, [token.sub, orgCode]);
                      }
                      await c.query("COMMIT");
                    } catch (err) {
                      await c.query("ROLLBACK").catch(() => {});
                      throw err;
                    }
                  }
                } finally { c.release(); }
              }).catch((err) => {
                // Never blocks sign-in, but no longer vanishes either.
                console.error("[auth] pre-authorized partner attribution failed:", err);
              });
            }
          }
        }
      }
      // Stable session id (3B): a CUSTOM claim (`sid`) -- NOT `jti`, which is a
      // reserved JWT claim Auth.js rotates on every re-issue (that rotation is
      // exactly why an earlier attempt never matched). Minted once on sign-in,
      // then persists like `tier`; matched against user_session for the
      // active-devices list + revocation.
      //
      // Registered server-side at sign-in (F5): the user_session row is written
      // here, before the token is issued, and `sit` (signed-in-at, epoch
      // seconds) marks the token as registered. `iat` cannot serve: Auth.js
      // re-stamps it on every re-issue, so it is never the sign-in time. If the
      // row cannot be written the sign-in fails rather than issue a token the
      // middleware would treat as revoked.
      const isSignIn = trigger === "signIn" || trigger === "signUp";
      // B1, last check: whatever Auth.js linked or matched, a Google sign-in
      // must land on the account whose email is the Google address. If not,
      // the Google link just written for this account is removed and the
      // sign-in ends on /login (the browser keeps any session it had).
      let googleMatched = false;
      if (isSignIn && token.sub && account?.provider === "google") {
        const { enforceGoogleAccountMatch, GoogleLinkRefused } = await import("@/lib/sign-in-guards");
        googleMatched = await enforceGoogleAccountMatch(pool, {
          userId: token.sub,
          profileEmail: (profile as any)?.email,
          providerAccountId: String(account.providerAccountId ?? ""),
        });
        if (!googleMatched) throw new GoogleLinkRefused();
      }
      if (isSignIn && token.sub) {
        (token as any).sid = newSessionId(token.sub);
        (token as any).sit = nowSeconds();

        // Second step (F1). Password sign-in already demanded the code inside
        // authorize(); an email link or Google sign-in into an account with
        // two-step starts the session waiting for it (mfa: false) and the
        // middleware holds it at /login/verify until the code is entered.
        // F3: an email-link or verified Google sign-in proves the inbox. On an
        // account whose address was never proven, the person is asked first
        // (claim): keep the two-step or password by entering it, or say "I
        // didn't set this" to remove it. Nothing is removed here.
        delete (token as any).claim;
        // How this session signed in (for the consent ledger), and whether the
        // account has accepted the current terms (lib/terms.ts).
        (token as any).via = account?.provider ?? null;
        try {
          const t = await pool.query(CONSENT_LOOKUP_SQL, [token.sub, TERMS_VERSION]);
          (token as any).terms = (t.rowCount ?? 0) > 0;
          (token as any).termsVersion = TERMS_VERSION;
          (token as any).termsAt = nowSeconds();
        } catch {
          delete (token as any).terms; // looked up again later
        }
        // Google counts as proof only for its own address (checked above).
        if (account?.provider === "resend" || (account?.provider === "google" && googleMatched)) {
          const { readProofState, claimForInboxProof, markEmailProven } = await import("@/lib/email-proof");
          const state = await readProofState(pool, token.sub);
          if (state) {
            const owed = claimForInboxProof(state);
            // "none" (already proven, possibly only by 068's backfill) and
            // "prove" both record HOW: this sign-in is a real inbox proof.
            const { proofSourceFor } = await import("@/lib/email-proof");
            if (owed === "prove" || owed === "none") await markEmailProven(pool, token.sub, proofSourceFor(account?.provider));
            else if (owed === "2fa" || owed === "password") (token as any).claim = owed;
          }
        }

        const tf = await pool.query(`SELECT two_factor_enabled FROM users WHERE id = $1`, [token.sub]);
        const twoFactor = !!tf.rows[0]?.two_factor_enabled;
        const viaPassword = account?.provider === "password-login";
        (token as any).mfa = viaPassword || !twoFactor;
        if (viaPassword && twoFactor) (token as any).mfaAt = (token as any).sit;
        else delete (token as any).mfaAt;

        const { recordSignIn } = await import("@/lib/session-registry");
        await recordSignIn(pool, {
          sid: (token as any).sid,
          userId: token.sub,
          email: (token.email as string | undefined) ?? null,
          name: (token.name as string | undefined) ?? null,
        });
      }
      if (token.sub && !(token as any).sid) {
        (token as any).sid = newSessionId(token.sub);
      }

      // After the step-up route records the code for this session, the page
      // calls update(). The claim flips ONLY from the database row, never from
      // anything the client sent (the update payload is ignored).
      if (trigger === "update" && token.sub && (token as any).sid) {
        try {
          const rows = (await sqlEdge`
            SELECT mfa_verified_at FROM user_session
             WHERE jti = ${(token as any).sid} AND user_id = ${token.sub}::uuid
               AND revoked_at IS NULL
             LIMIT 1`) as any[];
          const at = rows[0]?.mfa_verified_at ? new Date(rows[0].mfa_verified_at).getTime() : NaN;
          if (Number.isFinite(at)) {
            (token as any).mfa = true;
            (token as any).mfaAt = Math.floor(at / 1000);
          }
        } catch {
          // Leave the claims as they were; the person can try again.
        }
        // F3: the first-proof choice is settled only by the account itself:
        // proven address clears the claim, and a code is no longer owed once
        // the account has no two-step ("I didn't set this" removed it).
        if ((token as any).claim || (token as any).mfa === false) {
          try {
            const u = (await sqlEdge`
              SELECT two_factor_enabled, email_proven_at FROM users
               WHERE id = ${token.sub}::uuid LIMIT 1`) as any[];
            if (u.length) {
              if (u[0].email_proven_at) delete (token as any).claim;
              if (!u[0].two_factor_enabled && (token as any).mfa === false) (token as any).mfa = true;
            }
          } catch {
            // Before migration 068 there is no claim to clear; otherwise retry later.
          }
        }
      }

      // Terms: read again on update() (the terms page), when never read, when
      // read for an older TERMS_VERSION, and at least daily (lib/terms.ts
      // termsNeedsReread). Only ever set from the database row, never from
      // anything the client sent.
      if (
        token.sub &&
        termsNeedsReread({
          trigger,
          terms: (token as any).terms,
          termsVersion: (token as any).termsVersion,
          termsAt: (token as any).termsAt,
          now: nowSeconds(),
        })
      ) {
        try {
          const rows = (await sqlEdge`
            SELECT 1 FROM consumer_consent
             WHERE user_id = ${token.sub}::uuid AND consent_layer = 'core' AND status = 'granted'
               AND consent_text_version = ${TERMS_VERSION}
             LIMIT 1`) as any[];
          (token as any).terms = rows.length > 0;
          (token as any).termsVersion = TERMS_VERSION;
          (token as any).termsAt = nowSeconds();
        } catch {
          // Left as it was. The gate needs the current version AND true, so a
          // claim from an older version still fails closed; a daily re-read
          // that cannot reach the database keeps the last answer.
        }
      }

      // Sessions signed in before F1 carry no `mfa` claim. One minted by an
      // email link into a two-step account never saw a code, so an older
      // session of a two-step account is asked for the code once. Edge-safe
      // (HTTP query); on a DB error the claim stays unset and is retried.
      if (token.sub && (token as any).mfa === undefined) {
        try {
          const rows = (await sqlEdge`SELECT two_factor_enabled FROM users WHERE id = ${token.sub}::uuid LIMIT 1`) as any[];
          if (rows.length) (token as any).mfa = !rows[0].two_factor_enabled;
        } catch {
          // fail open, as the revocation check does
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub || "";
        (session.user as any).tier = token.tier || "client";
        (session.user as any).sid = (token as any).sid || null;
        // Signed-in-at (epoch seconds), only on sessions registered at sign-in.
        (session.user as any).sit = typeof (token as any).sit === "number" ? (token as any).sit : null;
        // Second step (F1): false only while the code is still owed.
        (session.user as any).mfa = (token as any).mfa !== false;
        (session.user as any).mfaAt = typeof (token as any).mfaAt === "number" ? (token as any).mfaAt : null;
        // F3: "2fa" or "password" while the first-proof choice is owed.
        (session.user as any).claim = (token as any).claim ?? null;
        // M4: true once the account accepted the current terms (lib/terms.ts).
        (session.user as any).terms = (token as any).terms === true;
        (session.user as any).termsVersion = (token as any).termsVersion ?? null;
        (session.user as any).via = (token as any).via ?? null;
      }
      return session;
    },
  },
});
