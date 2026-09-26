import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool, neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Edge-safe HTTP query (works in the middleware `authorized` callback) for the
// per-request session-revocation check. Fail-open on any error so a DB blip can
// never lock everyone out.
// no-store: this is the session-revocation check. Next patches fetch and can
// cache an identical query; a cached "session is valid" would outlive a revoke.
const sqlEdge = neon(process.env.DATABASE_URL!, { fetchOptions: { cache: "no-store" } });
async function isSessionRevoked(jti: string): Promise<boolean> {
  try {
    const rows = await sqlEdge`SELECT 1 FROM user_session WHERE jti = ${jti} AND revoked_at IS NOT NULL LIMIT 1`;
    return (rows as any[]).length > 0;
  } catch {
    return false;
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
        // is only UX. Backup codes are consumed on use.
        if (user.two_factor_enabled) {
          const totp = String((credentials as any)?.totp || "").replace(/\s/g, "");
          if (!totp) return null;
          const tf = await client.query(
            `SELECT secret, secret_iv, secret_tag, secret_key_version, backup_codes
               FROM user_two_factor WHERE user_id = $1`,
            [user.id]
          );
          const row = tf.rows[0];
          let ok = false;
          if (row?.secret) {
            const { verifyToken, resolveTotpSecret, encryptTotpSecret } = await import(
              "@/lib/two-factor"
            );
            // Guard the decrypt: a missing/rotated DOCUMENT_ENCRYPTION_KEY or a
            // corrupt iv/tag must NOT throw out of authorize() (that 500s the
            // whole login). Leave ok=false and fall through to the backup-code
            // path so a user with a valid backup code can still get in. Legacy
            // plaintext rows never enter the decrypt branch anyway.
            let plainSecret: string | null = null;
            try {
              plainSecret = resolveTotpSecret(row, user.id);
            } catch (err) {
              console.error("TOTP secret decrypt failed at login:", err);
            }
            if (plainSecret) ok = verifyToken(totp, plainSecret);

            // Backfill-on-next-use (Phase 1C): this row predates
            // TOTP-secret-at-rest encryption. Having just proven possession
            // of the secret, opportunistically re-encrypt and persist it so
            // it's ciphertext going forward. Best-effort -- a failure here
            // must never block a successful login.
            if (ok && plainSecret && !row.secret_iv) {
              try {
                const enc = encryptTotpSecret(plainSecret, user.id);
                await client.query(
                  `UPDATE user_two_factor
                      SET secret = $2, secret_iv = $3, secret_tag = $4, secret_key_version = $5, updated_at = now()
                    WHERE user_id = $1`,
                  [user.id, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion]
                );
              } catch (err) {
                console.error("TOTP secret backfill-encrypt failed:", err);
              }
            }

            // Backup-code fallback -- consumption must be atomic. A plain
            // SELECT-then-UPDATE lets two concurrent requests both read the
            // same array, both pass bcrypt.compare on the same code, and
            // both succeed (the code gets used twice). Instead this does
            // optimistic concurrency: the UPDATE's WHERE clause repeats the
            // exact snapshot just read, so only the first writer's UPDATE
            // matches a row and the second gets rowCount 0 and is rejected
            // as already-used, rather than silently double-spending.
            if (!ok && Array.isArray(row.backup_codes)) {
              const snapshot = row.backup_codes as string[];
              for (let i = 0; i < snapshot.length; i++) {
                if (await bcrypt.compare(totp, snapshot[i])) {
                  const remaining = snapshot.filter((_, j) => j !== i);
                  const upd = await client.query(
                    `UPDATE user_two_factor
                        SET backup_codes = $3::jsonb
                      WHERE user_id = $1 AND backup_codes = $2::jsonb`,
                    [user.id, JSON.stringify(snapshot), JSON.stringify(remaining)]
                  );
                  ok = upd.rowCount === 1;
                  break;
                }
              }
            }
          }
          if (!ok) return null;
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
    async authorized({ request, auth: session }) {
      const path = request.nextUrl.pathname;
      const isApi = path.startsWith("/api/");
      const isDashboard = path.startsWith("/dashboard");

      // Dashboard pages: redirect to login if not authenticated
      if (isDashboard && !session) {
        return Response.redirect(new URL("/login", request.url));
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
      // every page + data call. Skip auth-internal polling (/api/auth/*) to
      // keep the DB check off the hot session-poll path.
      const sid = (session?.user as any)?.sid as string | undefined;
      if (session && sid && (isDashboard || (isApi && !path.startsWith("/api/auth/")))) {
        if (await isSessionRevoked(sid)) {
          if (isApi) {
            return Response.json({ error: "Session revoked" }, { status: 401 });
          }
          return Response.redirect(new URL("/login", request.url));
        }
      }

      return true;
    },
    async jwt({ token, user, trigger }) {
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
      if (token.sub && !(token as any).sid) {
        try {
          (token as any).sid = globalThis.crypto.randomUUID();
        } catch {
          (token as any).sid = `${token.sub}-${Date.now()}`;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub || "";
        (session.user as any).tier = token.tier || "client";
        (session.user as any).sid = (token as any).sid || null;
      }
      return session;
    },
  },
});
