import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool as any),
  providers: [
    Resend({
      from: "Crucible <onboarding@resend.dev>",
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/check-email",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
