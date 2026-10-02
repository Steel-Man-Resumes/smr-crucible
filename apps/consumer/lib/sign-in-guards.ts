/**
 * Decisions made in the Auth.js `signIn` callback, before a session exists.
 *
 * The signIn callback runs only inside the /api/auth/[...nextauth] route (Node
 * runtime), never in the Edge middleware; auth.ts imports this module
 * dynamically from that callback. The decision functions are pure so the rules
 * can be tested without a database.
 */
import type { Db } from "@/lib/session-registry";

/** Where a refused sign-in lands; the login page explains each code. */
export const SIGN_IN_REFUSED = {
  googleEmailUnverified: "/login?error=GoogleEmailUnverified",
  googleLinkBlocked: "/login?error=GoogleLinkBlocked",
} as const;

export interface ExistingAccount {
  id: string;
  hasPassword: boolean;
  twoFactor: boolean;
}

/**
 * Google sign-in rule (F2).
 *  - Google must say it verified the address (`email_verified === true`).
 *    Auth.js links by email without checking that claim.
 *  - A Google identity already linked to an account signs into that account.
 *  - Otherwise Google is auto-linked to an existing same-email account only
 *    when that account has no password and no two-step verification. An
 *    account that does is not handed to whoever controls a Google identity
 *    for the address (a Workspace admin of the domain, a re-registered
 *    domain). `allowDangerousEmailAccountLinking` stays on for the passwordless
 *    accounts it was turned on for.
 */
export function googleSignInVerdict(input: {
  emailVerified: unknown;
  alreadyLinked: boolean;
  existing: ExistingAccount | null;
}): "ok" | "unverified" | "link-blocked" {
  if (input.emailVerified !== true) return "unverified";
  if (input.alreadyLinked) return "ok";
  if (input.existing && (input.existing.hasPassword || input.existing.twoFactor)) {
    return "link-blocked";
  }
  return "ok";
}

export async function findAccountByEmail(db: Db, email: string): Promise<ExistingAccount | null> {
  const r = await db.query(
    `SELECT id, password_hash IS NOT NULL AS has_password, two_factor_enabled
       FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  const row = r.rows[0];
  return row
    ? { id: row.id, hasPassword: !!row.has_password, twoFactor: !!row.two_factor_enabled }
    : null;
}

export async function isProviderAccountLinked(
  db: Db,
  provider: string,
  providerAccountId: string
): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM accounts WHERE provider = $1 AND "providerAccountId" = $2 LIMIT 1`,
    [provider, providerAccountId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * The whole Google check: returns true to continue, or the URL to send the
 * person to instead.
 */
export async function checkGoogleSignIn(
  db: Db,
  input: { profile: any; providerAccountId: string }
): Promise<true | string> {
  if (input.profile?.email_verified !== true) return SIGN_IN_REFUSED.googleEmailUnverified;
  const email = typeof input.profile?.email === "string" ? input.profile.email.trim() : "";
  const alreadyLinked = await isProviderAccountLinked(db, "google", input.providerAccountId);
  const existing = !alreadyLinked && email ? await findAccountByEmail(db, email) : null;
  const verdict = googleSignInVerdict({
    emailVerified: input.profile?.email_verified,
    alreadyLinked,
    existing,
  });
  if (verdict === "unverified") return SIGN_IN_REFUSED.googleEmailUnverified;
  if (verdict === "link-blocked") return SIGN_IN_REFUSED.googleLinkBlocked;
  return true;
}
