import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const isDev = process.env.NODE_ENV === "development";

// Emails that receive partner tier automatically on sign-in (no code required)
const PARTNER_PRE_AUTH = ["latonyabakergoe@gmail.com"];

const providers: any[] = [
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
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const email = (credentials.email as string).toLowerCase().trim();
      const password = credentials.password as string;

      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, name, email, image, tier, password_hash FROM users WHERE email = $1`,
          [email]
        );
        if (result.rows.length === 0) return null;

        const user = result.rows[0];
        if (!user.password_hash) return null; // No password set — must use magic link

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool as any),
  providers,
  // JWT strategy required for Credentials provider in NextAuth 5
  session: {
    strategy: "jwt",
  },
  // Share session cookie across all .steelmanresumes.com subdomains
  // so the marketing site can detect auth state
  ...(isProduction && {
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
          "/api/job-search", "/api/resources-search", "/api/resume-generate",
          "/api/usage", "/api/user/",
        ];
        if (protectedPrefixes.some((p) => path.startsWith(p))) {
          return Response.json({ error: "Not authenticated" }, { status: 401 });
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
              pool.connect().then(async (c) => {
                try {
                  await c.query(
                    `UPDATE users SET tier = 'partner' WHERE id = $1 AND tier NOT IN ('admin', 'unlimited', 'partner')`,
                    [token.sub]
                  );
                } finally { c.release(); }
              }).catch(() => {});
            }
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub || "";
        (session.user as any).tier = token.tier || "client";
      }
      return session;
    },
  },
});
