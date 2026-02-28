import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const isDev = process.env.NODE_ENV === "development";

const providers: any[] = [
  Resend({
    from: process.env.AUTH_EMAIL_FROM || "onboarding@resend.dev",
  }),
];

if (isDev) {
  providers.push(
    Credentials({
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
            `SELECT id, name, email, "emailVerified", image FROM users WHERE email = $1`,
            [email]
          );
          if (result.rows.length === 0) {
            result = await client.query(
              `INSERT INTO users (name, email, "emailVerified") VALUES ($1, $2, NOW()) RETURNING id, name, email, "emailVerified", image`,
              [email.split("@")[0], email]
            );
          }
          const user = result.rows[0];
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
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
  session: {
    strategy: isDev ? "jwt" : "database",
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  callbacks: {
    async session({ session, user, token }) {
      if (session.user) {
        session.user.id = user?.id || token?.sub || "";
      }
      return session;
    },
  },
});
