/**
 * Decisions made in the Auth.js `signIn` callback, before a session exists.
 *
 * The signIn callback runs only inside the /api/auth/[...nextauth] route (Node
 * runtime), never in the Edge middleware; auth.ts imports this module
 * dynamically from that callback. Pure, so the rule can be tested alone.
 */

/** Where a refused sign-in lands; the login page explains each code. */
export const SIGN_IN_REFUSED = {
  googleEmailUnverified: "/login?error=GoogleEmailUnverified",
} as const;

/**
 * Google sign-in rule (F2). Google must say it verified the address
 * (`email_verified === true`, exactly). Auth.js links a Google identity to a
 * same-email account (allowDangerousEmailAccountLinking) without checking that
 * claim, and an unverified address proves nothing about who owns the inbox.
 *
 * A verified Google sign-in is then treated exactly like an email-link
 * sign-in: two-step accounts get the step-up (F1), and an account whose
 * address was never proven gets the first-proof choice (F3, lib/email-proof.ts).
 */
export function googleEmailVerified(profile: unknown): boolean {
  return (profile as { email_verified?: unknown } | null | undefined)?.email_verified === true;
}
