import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const isDev = process.env.NODE_ENV === "development";

const providers: any[] = [
  Resend({
    from: process.env.AUTH_EMAIL_FROM || "onboarding@resend.dev",
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
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const email = credentials.email as string;
        const client = await pool.connect();
        try {
          let result = await client.query(
            `SELECT id, name, email, "emailVerified", image, tier FROM users WHERE email = $1`,
            [email]
          );
          if (result.rows.length === 0) {
            result = await client.query(
              `INSERT INTO users (name, email, "emailVerified") VALUES ($1, $2, NOW()) RETURNING id, name, email, "emailVerified", image, tier`,
              [email.split("@")[0], email]
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool as any),
  providers,
  // JWT strategy required for Credentials provider in NextAuth 5
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  callbacks: {
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
