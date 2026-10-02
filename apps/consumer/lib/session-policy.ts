/**
 * Session rules shared by the Edge middleware (auth.ts `authorized`) and the
 * Node routes. Pure: no imports, so it is safe in the Edge bundle and in unit
 * tests.
 *
 * HOW A SESSION IS TRACKED (F5, 2026-10-02). Every sign-in writes its
 * user_session row on the server, inside the sign-in itself, and stamps the
 * token with `sit` (signed-in-at, epoch seconds). Before this, the row was only
 * written when a browser loaded the dashboard and called /api/auth/session-ping,
 * so a scripted session never appeared in the device list and could never be
 * revoked.
 *
 * Tokens signed in before the cutoff carry no `sit`. They keep working (nobody
 * is signed out by the deploy) under the old rule, with one addition: once the
 * user signs out other devices, or changes a password or two-step setting, an
 * old token that never registered a row stops working too (see
 * revocationVerdict).
 */

/**
 * Sign-ins at or after this instant are registered server-side. Set to the
 * commit time of the change that introduced registration; a token whose `sit`
 * is at or after it and that has no row was never legitimately issued (or its
 * row was removed), so it is refused.
 */
export const SESSION_REGISTRY_CUTOFF = "2026-10-02T23:11:00Z";
const CUTOFF_MS = Date.parse(SESSION_REGISTRY_CUTOFF);

/** Login-event name written whenever a user's other sessions are revoked. */
export const SESSIONS_REVOKED_EVENT = "sessions_revoked";

/** True when this token was signed in by code that registers its row. */
export function sessionRowRequired(signedInAt: unknown): boolean {
  return (
    typeof signedInAt === "number" &&
    Number.isFinite(signedInAt) &&
    signedInAt * 1000 >= CUTOFF_MS
  );
}

/**
 * Whether a session is revoked.
 *  - It has a row: the row decides (revoked_at set means revoked).
 *  - No row, registered sign-in: revoked (the row is written before the token
 *    is issued, so a missing row means it was never issued by us, or removed).
 *  - No row, older token: revoked only if the user swept their sessions
 *    (signed out other devices, reset or changed a password, changed two-step)
 *    after the cutoff. `sweptSinceCutoff` null means "not checked".
 */
export function revocationVerdict(input: {
  row: { revoked: boolean } | null;
  signedInAt: unknown;
  sweptSinceCutoff: boolean | null;
}): boolean {
  if (input.row) return input.row.revoked;
  if (sessionRowRequired(input.signedInAt)) return true;
  return input.sweptSinceCutoff === true;
}

/** Epoch seconds, the unit JWT claims use. */
export function nowSeconds(now: number = Date.now()): number {
  return Math.floor(now / 1000);
}

/**
 * /api/auth/* routes that skip the per-session checks in the middleware
 * (revocation, F6; pending second step, F1).
 *
 *  - NextAuth's own actions: they are how a session is created, read and
 *    ended, so a revoked session must still reach signout and the sign-in
 *    callbacks.
 *  - The pre-sign-in routes: they never read the session. A device whose
 *    session was revoked still carries the cookie, and must still be able to
 *    sign in again or reset a password.
 *
 * Every other /api/auth/* route (set-password, session-ping, and any custom
 * route added later) gets the checks by default.
 */
const NEXTAUTH_ACTIONS = new Set([
  "session",
  "csrf",
  "providers",
  "signin",
  "callback",
  "signout",
  "verify-request",
  "error",
]);
const PRE_SIGN_IN_ROUTES = new Set(["password-precheck", "register", "reset-password"]);

export function authRouteSkipsSessionChecks(path: string): boolean {
  if (!path.startsWith("/api/auth/")) return false;
  const first = path.slice("/api/auth/".length).split("/")[0];
  return NEXTAUTH_ACTIONS.has(first) || PRE_SIGN_IN_ROUTES.has(first);
}

/** How recent a sign-in must be to add a first password to an account (F6). */
export const FRESH_SIGN_IN_SECONDS = 10 * 60;

/** True when the session was signed in (registry `sit`) within `maxAge` seconds. */
export function signedInWithin(
  signedInAt: unknown,
  maxAgeSeconds: number,
  now: number = Date.now()
): boolean {
  if (typeof signedInAt !== "number" || !Number.isFinite(signedInAt)) return false;
  const age = nowSeconds(now) - signedInAt;
  return age >= -60 && age <= maxAgeSeconds;
}
