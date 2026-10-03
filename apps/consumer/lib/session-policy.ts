/**
 * Session rules shared by the Edge middleware (auth.ts `authorized`) and the
 * Node routes. Pure (its only import is the pure safe-path helper), so it is
 * safe in the Edge bundle and in unit tests.
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
import { isSafeRelativePath } from "./safe-path";

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

/*
 * SECOND STEP ON EVERY SIGN-IN METHOD (F1, 2026-10-02).
 *
 * Token claims, set in auth.ts `jwt`:
 *  - mfa:   false while an account with two-step verification has signed in
 *           by email link or Google and has not entered a code yet. Password
 *           sign-in already requires the code inside authorize(), so it starts
 *           true. Accounts without two-step start true.
 *  - mfaAt: epoch seconds when this session presented a second factor
 *           (password + code, the step-up, or turning two-step on). Absent
 *           when it never did.
 *
 * A session with mfa === false can reach only the step-up route, NextAuth's
 * own routes and the pre-sign-in routes; pages send it to /login/verify.
 * Admin powers need mfaAt.
 */
export const MFA_VERIFY_PATH = "/api/auth/mfa-verify";
export const MFA_VERIFY_PAGE = "/login/verify";

/** Whether a session still waiting for its second step is blocked on `path`. */
export function mfaGateApplies(path: string): boolean {
  if (path === MFA_VERIFY_PATH) return false;
  return !authRouteSkipsSessionChecks(path);
}

/** Paths that exercise admin powers (cross-user tools, impersonation). */
const ADMIN_POWER_PREFIXES = ["/api/admin/", "/api/dev/", "/dashboard/admin"];

export function isAdminPowerPath(path: string): boolean {
  return ADMIN_POWER_PREFIXES.some((p) =>
    p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(p + "/")
  );
}

/** True when this session presented a second factor. */
export function hasSecondFactor(mfaAt: unknown): boolean {
  return typeof mfaAt === "number" && Number.isFinite(mfaAt) && mfaAt > 0;
}

/**
 * Admin powers require a session that presented a second factor (F1): an
 * admin without two-step, or signed in without the code, keeps their own
 * account but not the tools that reach other people's data. Local development
 * (dev-login, no two-step) is exempt.
 */
export function adminSecondFactorOk(user: { mfaAt?: unknown } | null | undefined): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return hasSecondFactor(user?.mfaAt);
}

/**
 * A same-site path to return to after the step-up, or the dashboard. Uses the
 * shared isSafeRelativePath rule (no backslash or control character anywhere:
 * "/\t/evil.com" is "//evil.com" to a browser).
 */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (!isSafeRelativePath(raw)) return "/dashboard";
  if (raw.startsWith(MFA_VERIFY_PAGE)) return "/dashboard";
  return raw;
}
