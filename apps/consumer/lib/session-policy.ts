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
import { isForgeSignInPage, isForgeSignedOutApi } from "./forge-access";

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
/** F3: keep the password / "I didn't set this" on a first inbox proof. */
export const CLAIM_PASSWORD_PATH = "/api/auth/claim-password";
export const CLAIM_RESET_PATH = "/api/auth/claim-reset";

const PENDING_STEP_ROUTES = new Set([MFA_VERIFY_PATH, CLAIM_PASSWORD_PATH, CLAIM_RESET_PATH]);

/** Whether a session still waiting for its second step (or F3 choice) is blocked on `path`. */
export function mfaGateApplies(path: string): boolean {
  if (PENDING_STEP_ROUTES.has(path)) return false;
  return !authRouteSkipsSessionChecks(path);
}

/**
 * True while a session owes a step before it can use the account: a two-step
 * code (mfa === false), or the F3 choice on an account whose address was never
 * proven (claim "2fa" or "password", see lib/email-proof.ts).
 */
export function sessionPending(user: { mfa?: unknown; claim?: unknown } | null | undefined): boolean {
  return user?.mfa === false || user?.claim === "2fa" || user?.claim === "password";
}

/*
 * FORGE ROUTES SERVE A PENDING SESSION AS SIGNED OUT (S1, 2026-10-06).
 *
 * The session cookie is shared across the steelmanresumes.com hosts, so a
 * Refinery sign-in that still owes its code rides along to the Forge. The
 * Forge needs no sign-in, yet the hold above turned its upload and writing
 * calls into "Enter your two-step code" errors.
 *
 * These exact paths are the API routes the Forge pages call that work with no
 * session at all (IP rate limited, or no session use). For them a pending
 * session is treated exactly like no session, by two independent locks:
 *  1. the hold does not apply, and the middleware removes every cookie Auth.js
 *     would read as the session (forgeAnonymousRequestHeaders), so the route's
 *     own auth() normally sees nobody;
 *  2. the routes that read the session take the user through forgeUserId /
 *     forgeSessionUser, which return nothing for a pending session, so no work
 *     is credited to the account even if a session cookie got through.
 * A pending session gains nothing here that a signed-out visitor does not
 * already have.
 *
 * Exact match only. Account routes (/api/forge/save, /api/forge/load,
 * /api/forge/summary, /api/consent, /api/sharing/*, /api/support-request,
 * /api/user/*, /api/coach/*) are deliberately absent and stay held.
 */
const FORGE_ANONYMOUS_API_ROUTES = new Set([
  "/api/check/extract",
  "/api/parse",
  "/api/analyze",
  "/api/rush-resume",
  "/api/forge/generate-docs",
  "/api/forge/download",
  "/api/forge/email-package",
  "/api/forge/resume-assist",
  "/api/resume/fit-check",
  "/api/resume/layout",
  "/api/assistant",
  "/api/org-listing",
]);

/** True for an API route the Forge calls that works with no session. */
export function isForgeAnonymousApiRoute(path: string): boolean {
  return FORGE_ANONYMOUS_API_ROUTES.has(path);
}

/*
 * ONCE THE WALL IS UP (lib/forge-access.ts) only the routes on
 * FORGE_SIGNED_OUT_API_ALLOWLIST still work with no session. The rest of the
 * list above then needs a signed-in, fully verified session, so a pending
 * session is HELD there (code page / 401), exactly like any account route. It
 * is never served as signed out: being served as signed out on a route that
 * needs a session would only turn the hold into a "sign in" error.
 */

/**
 * True when this Forge API route needs a session: it is on the Forge list
 * above, the wall is up, and it is not on the signed-out allowlist.
 */
export function forgeApiNeedsSession(path: string, wallUp: boolean): boolean {
  return wallUp && isForgeAnonymousApiRoute(path) && !isForgeSignedOutApi(path);
}

/**
 * The wall's first question for any request the middleware sees, before the
 * revocation and second-step checks:
 *  - "open":     a Forge screen before the wall; let it through untouched, as
 *                when the middleware did not match these pages at all;
 *  - "sign-in":  a Forge screen after the wall, signed out: go to sign-in and
 *                come back (see forgeSignInUrl);
 *  - "refuse":   a walled Forge API route, signed out: 401;
 *  - "continue": everything else; the usual checks decide.
 */
export function forgeGateVerdict(
  path: string,
  signedIn: boolean,
  wallUp: boolean
): "open" | "sign-in" | "refuse" | "continue" {
  if (isForgeSignInPage(path)) {
    if (!wallUp) return "open";
    return signedIn ? "continue" : "sign-in";
  }
  if (!signedIn && forgeApiNeedsSession(path, wallUp)) return "refuse";
  return "continue";
}

/** A Forge route a pending session is served on as signed out. */
function servedSignedOut(path: string, wallUp: boolean): boolean {
  return isForgeAnonymousApiRoute(path) && !forgeApiNeedsSession(path, wallUp);
}

/**
 * What the pending-session rule does on `path`:
 *  - "none":      the session is not pending, or the path is a step-up or
 *                 sign-in route a pending session may use as itself;
 *  - "anonymous": a Forge route that works signed out; serve it as signed out;
 *  - "hold":      everything else; pages go to the code page, APIs get 401.
 */
export function pendingSessionTreatment(
  path: string,
  user: { mfa?: unknown; claim?: unknown } | null | undefined,
  wallUp: boolean = false
): "none" | "anonymous" | "hold" {
  if (!sessionPending(user)) return "none";
  if (servedSignedOut(path, wallUp)) return "anonymous";
  return mfaGateApplies(path) ? "hold" : "none";
}

/**
 * Cookies Auth.js reads as the session. Its SessionStore takes EVERY cookie
 * whose name starts with the configured session cookie name and joins them
 * (chunks), so "authjs.session-token-x" or "authjs.session-tokenZ" is read as
 * the session too. This is the same prefix rule, for both names Auth.js may be
 * configured with (plain, and __Secure- on https without the shared domain).
 */
const SESSION_COOKIE_PREFIXES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * A copy of the request headers with every cookie Auth.js would read as the
 * session removed from the Cookie header (other cookies kept). Split the way
 * Auth.js parses it: pairs separated by ";", the name is the text before the
 * first "=" with surrounding whitespace removed. A repeated name is removed
 * every time. Edge-safe.
 */
export function headersWithoutSessionCookie(headers: Headers): Headers {
  const out = new Headers(headers);
  const raw = out.get("cookie");
  if (!raw) return out;
  const kept = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !isSessionCookieName(part.split("=")[0].trim()));
  if (kept.length) out.set("cookie", kept.join("; "));
  else out.delete("cookie");
  return out;
}

/**
 * Lock 1, used by the middleware: the request headers a Forge route should run
 * with for this session, or null to leave the request as it is.
 */
export function forgeAnonymousRequestHeaders(
  path: string,
  user: { mfa?: unknown; claim?: unknown } | null | undefined,
  headers: Headers,
  wallUp: boolean = false
): Headers | null {
  if (pendingSessionTreatment(path, user, wallUp) !== "anonymous") return null;
  return headersWithoutSessionCookie(headers);
}

type SessionLike = { user?: { id?: string | null; email?: string | null } | null } | null | undefined;

/**
 * Lock 2, used by the Forge routes that read the session: the signed-in user,
 * or null when there is none or it still owes its code or first-proof choice.
 */
export function forgeSessionUser(session: SessionLike): { id: string; email: string | null } | null {
  const user = session?.user as
    | { id?: string | null; email?: string | null; mfa?: unknown; claim?: unknown }
    | null
    | undefined;
  if (!user || sessionPending(user)) return null;
  if (typeof user.id !== "string" || !user.id) return null;
  return { id: user.id, email: user.email ?? null };
}

/** The user id a Forge route may credit work to, or undefined. */
export function forgeUserId(session: SessionLike): string | undefined {
  return forgeSessionUser(session)?.id;
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

/**
 * The page to return to after signing in (the login page's callbackUrl). A
 * same-site path only (isSafeRelativePath), never the login pages themselves
 * (a loop) and never an API route (a page of JSON); otherwise the dashboard.
 */
export function safeLoginReturn(raw: string | null | undefined): string {
  if (!isSafeRelativePath(raw)) return "/dashboard";
  const path = raw.split(/[?#]/)[0];
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/api/")) return "/dashboard";
  return raw;
}

/** The account route that saves a Forge run (gated by terms with the Forge). */
export const FORGE_SAVE_PATH = "/api/forge/save";

/**
 * Terms gate (security review 3a r1, M4), once the wall is up: a session whose
 * account has not accepted the current terms reaches no Forge screen ("page":
 * go to the one-tap page) and no walled Forge API nor the run save ("api":
 * 401). Anything but `terms === true` counts as not accepted. The signed-out
 * allowlist and every non-Forge path are untouched ("pass").
 */
export function termsGateVerdict(path: string, wallUp: boolean, terms: unknown): "pass" | "page" | "api" {
  if (!wallUp || terms === true) return "pass";
  if (isForgeSignInPage(path)) return "page";
  if (forgeApiNeedsSession(path, true) || path === FORGE_SAVE_PATH) return "api";
  return "pass";
}

/**
 * Where a session's revocation is checked (security review 3a r1, L2):
 *  - "here":    in authorized(); a revoked session is refused (401 / sign-in);
 *  - "as-open": a route on the Forge's signed-out allowlist; the middleware
 *               checks it and, when revoked, serves the request as signed out
 *               (the cookie is stripped), so a stale cookie in the browser
 *               never breaks the free checker or t.ROY's public chat;
 *  - "skip":    NextAuth's own and the pre-sign-in routes (unchanged).
 */
export function revocationCheck(path: string): "here" | "as-open" | "skip" {
  if (isForgeSignedOutApi(path)) return "as-open";
  if (path.startsWith("/api/") && authRouteSkipsSessionChecks(path)) return "skip";
  return "here";
}
