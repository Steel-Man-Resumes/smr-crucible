/**
 * Decisions made in the Auth.js `signIn` callback, before a session exists,
 * plus the matching last check in the jwt callback.
 *
 * Both callbacks run only inside the /api/auth/[...nextauth] route (Node
 * runtime), never in the Edge middleware; auth.ts imports this module
 * dynamically. The decision is a pure function so the rules can be tested
 * without a database.
 */
import { AuthError } from "next-auth";
import type { Db } from "@/lib/session-registry";

/**
 * Ends a Google sign-in whose account email is not the Google address (B1).
 * Reported as OAuthAccountNotLinked (a client-safe Auth.js error of kind
 * "signIn"), so Auth.js sends the person to /login?error=OAuthAccountNotLinked,
 * where the code is explained and a Sign out button is offered.
 */
export class GoogleLinkRefused extends AuthError {
  static type = "OAuthAccountNotLinked" as const;
  static kind = "signIn" as const;
}

/** Where a refused sign-in lands; the login page explains each code. */
export const SIGN_IN_REFUSED = {
  googleEmailUnverified: "/login?error=GoogleEmailUnverified",
  // Signed in as one account, pressing Google for a different address. The
  // login page already explains this code and offers Sign out.
  sessionLinkRefused: "/login?error=OAuthAccountNotLinked",
  // The browser's current session is revoked or still owes a step.
  sessionNotUsable: "/login?error=SessionNotUsable",
  // This Google identity is linked to an account with a different address.
  googleEmailMismatch: "/login?error=GoogleEmailMismatch",
} as const;

/** The form Auth.js uses for email identifiers (NFKC, lower case, trimmed). */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.normalize("NFKC").toLowerCase().trim() : "";
}

/** Google must say it verified the address: `email_verified === true`, exactly. */
export function googleEmailVerified(profile: unknown): boolean {
  return (profile as { email_verified?: unknown } | null | undefined)?.email_verified === true;
}

/**
 * Google sign-in rule (F2, B1). A Google identity may sign into, attach to, or
 * prove ONLY the account whose email is the Google profile's own verified
 * address.
 *
 * Auth.js would otherwise (a) link a Google identity to whatever account the
 * browser is already signed into, whatever its email (handle-login: "If the
 * user is already signed in ... link the accounts"), and (b) trust any session
 * cookie that decodes, revoked or not. Combined with "a verified Google
 * sign-in proves the inbox" (F3), someone holding a session could attach
 * their own Google account to someone else's account and have it counted as
 * proof of that account's inbox.
 *
 *  - Google must have verified the address.
 *  - A browser already signed in may only use Google for its OWN address, and
 *    only if that session is live (not revoked, not owing a step).
 *  - A Google identity already linked to an account with a different address
 *    is refused (an account's Google link always matches its email).
 */
export function googleSignInDecision(input: {
  profile: unknown;
  /** Email of the account this Google identity is already linked to, if any. */
  linkedAccountEmail: string | null;
  /** The browser's current session, if it carries one. */
  session: { email: string | null; revoked: boolean; pending: boolean } | null;
}): true | string {
  const profileEmail = normalizeEmail((input.profile as { email?: unknown } | null)?.email);
  if (!googleEmailVerified(input.profile) || !profileEmail) return SIGN_IN_REFUSED.googleEmailUnverified;
  if (input.session) {
    if (input.session.revoked || input.session.pending) return SIGN_IN_REFUSED.sessionNotUsable;
    if (normalizeEmail(input.session.email) !== profileEmail) return SIGN_IN_REFUSED.sessionLinkRefused;
  }
  if (input.linkedAccountEmail !== null && normalizeEmail(input.linkedAccountEmail) !== profileEmail) {
    return SIGN_IN_REFUSED.googleEmailMismatch;
  }
  return true;
}

/** Auth.js session cookie names; one rule, shared with the middleware. */
export { isSessionCookieName } from "./session-policy";

/** What the browser brought to a Google sign-in, as far as linking is concerned. */
export type CurrentSessionRead =
  | { state: "none" }
  | { state: "session"; session: { email: string | null; revoked: boolean; pending: boolean } }
  | { state: "unreadable" };

/**
 * Read the browser's current session for the Google link check (B1), without
 * ever throwing out of the signIn callback.
 *
 *  - No session cookie: "none". The session is not read at all, so a failing
 *    read can never block an ordinary signed-out Google sign-in (almost all
 *    of them).
 *  - A cookie that reads as a session: its email, whether it is revoked
 *    (a failed revocation lookup counts as not revoked, the same fail-open
 *    rule the middleware uses), and whether it still owes a step.
 *  - A cookie that reads as NO session (expired, signed with an old secret,
 *    garbled): "none". Auth.js links an OAuth identity only to a session it
 *    can decode (handle-login decodes the same cookie), so there is no
 *    account to link into and no cross-account risk; refusing would trap
 *    everyone whose 30-day session simply expired.
 *  - A read that THROWS: "unreadable" (state unknown), which the caller
 *    refuses; the person can sign out, which clears the cookie, and retry.
 */
export async function readCurrentSessionForLink(deps: {
  hasSessionCookie: () => Promise<boolean>;
  getSession: () => Promise<{ user?: unknown } | null | undefined>;
  isRevoked: (sid: string, userId: string, signedInAt: unknown) => Promise<boolean>;
  isPending: (user: unknown) => boolean;
}): Promise<CurrentSessionRead> {
  let hasCookie = true;
  try {
    hasCookie = await deps.hasSessionCookie();
  } catch {
    hasCookie = true; // cannot tell: read the session to find out
  }
  if (!hasCookie) return { state: "none" };

  let user: any = null;
  try {
    user = (await deps.getSession())?.user ?? null;
  } catch {
    return { state: "unreadable" };
  }
  // Present but not a session (expired, old secret, garbled): nothing to link into.
  if (!user?.id) return { state: "none" };

  let revoked = false;
  if (user.sid) {
    try {
      revoked = await deps.isRevoked(user.sid, user.id, user.sit);
    } catch {
      revoked = false;
    }
  }
  return {
    state: "session",
    session: { email: user.email ?? null, revoked, pending: deps.isPending(user) },
  };
}

/** The Google sign-in decision from a session read (see googleSignInDecision). */
export function googleSignInGate(input: {
  profile: unknown;
  linkedAccountEmail: string | null;
  current: CurrentSessionRead;
}): true | string {
  if (input.current.state === "unreadable") {
    // Still refuse an unverified address first, so that reason is the one shown.
    if (!googleEmailVerified(input.profile)) return SIGN_IN_REFUSED.googleEmailUnverified;
    return SIGN_IN_REFUSED.sessionNotUsable;
  }
  return googleSignInDecision({
    profile: input.profile,
    linkedAccountEmail: input.linkedAccountEmail,
    session: input.current.state === "session" ? input.current.session : null,
  });
}

/** Email of the account a Google identity is linked to, or null when it is not linked. */
export async function linkedAccountEmail(db: Db, providerAccountId: string): Promise<string | null> {
  const r = await db.query(
    `SELECT u.email FROM accounts a JOIN users u ON u.id = a."userId"
      WHERE a.provider = 'google' AND a."providerAccountId" = $1 LIMIT 1`,
    [providerAccountId]
  );
  return r.rows.length ? String(r.rows[0].email ?? "") : null;
}

/**
 * Last check inside the sign-in (jwt callback), after Auth.js has linked or
 * matched the account: the account's email must be the Google profile's. If it
 * is not, the Google link Auth.js may have just written for this account is
 * deleted and the caller ends the sign-in. Returns true when they match.
 */
export async function enforceGoogleAccountMatch(
  db: Db,
  input: { userId: string; profileEmail: unknown; providerAccountId: string }
): Promise<boolean> {
  const r = await db.query(`SELECT email FROM users WHERE id = $1`, [input.userId]);
  const accountEmail = normalizeEmail(r.rows[0]?.email);
  const profileEmail = normalizeEmail(input.profileEmail);
  if (accountEmail && profileEmail && accountEmail === profileEmail) return true;
  await db.query(
    `DELETE FROM accounts WHERE provider = 'google' AND "providerAccountId" = $1 AND "userId" = $2`,
    [input.providerAccountId, input.userId]
  );
  return false;
}
