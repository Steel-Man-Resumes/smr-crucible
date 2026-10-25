/**
 * Refinery seats: the rules the edge, the pages and the AI admission share.
 * Pure (no database, no Node APIs): the middleware, the session callbacks,
 * the Forge pages and the tests all import it.
 *
 * THE MODEL (R4 DESIGN.md Option A, adopted 2026-10-23). Anyone may make a free
 * account and use the Forge; the Forge needs one (lib/forge-access.ts, wall up).
 * The Refinery needs a SEAT once a platform admin closes public sign-ups. What
 * counts as a seat is decided by the database (smr_has_refinery_seat,
 * migration 096) plus one rule only the environment knows (PARTNER_PRE_AUTH).
 * Nothing in this file reads users.tier, progression grants, premium grants or
 * browser storage, and nothing here may start to.
 *
 * Three places enforce it, each from the database, never from the request:
 *  1. the edge (auth.ts authorized()): Refinery pages go to SEAT_PAGE, Refinery
 *     API calls get 403 seatRequired, from a claim the jwt callback re-reads;
 *  2. AI admission (lib/ai-operation-server.ts): every Refinery AI call reads
 *     the database again, so a stale or missing claim never spends AI;
 *  3. the seat itself is spent only by smr_redeem_code (codes, invites,
 *     accepted offers).
 */

import { isForgeAnonymousApiRoute, isRefineryPage, termsExemptApi } from "./session-policy";
import { isForgeSignedOutApi } from "./forge-access";
import { isPartnerPreAuthorized } from "./partner-pre-auth";

/** Where a signed-in account without a seat is sent from a Refinery page. */
export const SEAT_PAGE = "/seat";

/**
 * The plain-words limits, for the tour and any page that explains access.
 * DRAFT for Troy. Every sentence is true of the code: the seat rule above, the
 * request queue Troy reviews (admin Access requests), the daily allowance
 * reset (lib/progression-server.ts, midnight UTC), and data rights that never
 * lock (export and delete are exempt from every gate). No numbers on purpose:
 * Troy can change the allowance from the admin page, so read it from GET
 * /api/progression where a number is needed.
 */
export const LIMITS_LINE =
  "The Forge is free with an account. The Refinery opens with a seat from an organization. If you do not have one, you can ask, and Troy reviews every request himself. Each seat has a daily AI allowance that resets at midnight UTC. Your saved work, your downloads and your data never lock.";

/** The one refusal an API call without a seat gets. */
export const SEAT_REQUIRED_MESSAGE =
  "The Refinery opens with a seat from an organization. Your Forge work is saved either way.";

/**
 * Refinery pages a seatless account may still open: its own settings (password,
 * two-step, active devices, download and delete its data). Everything else
 * under REFINERY_PAGE_PREFIXES goes to SEAT_PAGE.
 */
export const SEAT_EXEMPT_PAGES: Readonly<Record<string, string>> = {
  "/dashboard/settings": "the person's own account: password, two-step, devices, download and delete",
  "/dashboard/security": "the person's own sign-in security",
};

/**
 * API routes a signed-in account WITHOUT a seat may still use, each for a
 * reason. A superset of TERMS_EXEMPT_API and of the Forge's own route lists
 * (both checked in seatExemptApi, never copied, so they cannot drift). Every
 * other /api route needs a seat once sign-ups are closed. A trailing "/" is a
 * prefix; anything else is an exact path.
 *
 * lib/__tests__/refinery-access.test.ts walks the import graph of every Forge
 * page and fails when a Forge page calls a route that is neither here nor in
 * SEAT_GATED_FROM_FORGE, so a new Forge route cannot be walled by accident.
 */
export const SEAT_EXEMPT_API: Readonly<Record<string, string>> = {
  "/api/forge/": "the Forge's own account routes: save, load, summary, download, email the package, checks",
  "/api/revisions": "the Forge resume's saved versions (start and finish pages)",
  "/api/revisions/check": "the Forge finish page checks the saved version",
  "/api/revisions/rebuild": "the Forge rebuilds a resume from a saved version",
  "/api/assistant/correction": "a confirmed one-passage fix to the Forge resume from t.ROY's chat; no AI",
  "/api/lane-first": "the Forge saves the first result on the person's chosen route",
  "/api/lane-focus": "the Forge's first screen saves and reads today's task",
  "/api/user/journey": "the Forge start page reads whether the Forge was finished",
  "/api/user/profile": "the person's own profile (the Forge and Settings read it)",
  "/api/user/role": "who is signed in (shared page chrome)",
  "/api/user/context": "the person's own saved context (shared page chrome)",
  "/api/user/2fa/": "Settings: turn two-step on or off",
  "/api/user/sessions": "Settings: active devices",
  "/api/user/login-events": "Settings: recent sign-ins",
  "/api/user/package-email": "Settings: where the Forge package is emailed",
  "/api/user/security-status": "Settings: sign-in security status",
  "/api/user/ui-prefs": "Settings: text size and contrast",
  "/api/access-code/": "join an organization with a code, see and leave memberships",
  "/api/seat": "the seat page reads its status",
  "/api/seat/": "the seat page: ask for a seat, accept or decline an offer",
  "/api/consent": "consent records the person can always change",
  "/api/session-status": "session status for this browser",
  "/api/access-name": "the /access partner landing greets the organization; public, capped per IP, reads only an organization name",
  "/api/support-request": "ask for help",
  "/api/support-request/mine": "see your own help requests",
};

/**
 * Routes a Forge page's code can reach that stay seat-gated on purpose: shared
 * components call them only inside the Refinery (the Refinery coach chat, the
 * Refinery lane header, guided progression). Listed so the import-graph test
 * can tell "deliberately gated" from "forgot to decide".
 */
export const SEAT_GATED_FROM_FORGE: Readonly<Record<string, string>> = {
  "/api/coach": "the Refinery coach chat (AssistantChat with coach=true); the Forge chat uses /api/assistant",
  "/api/coach/proactive": "Refinery coach only (coach=true)",
  "/api/coach/settings": "Refinery coach only (coach=true)",
  "/api/progression": "Refinery guided progression (RefineryLaneHeader)",
  "/api/progression/unlock": "Refinery guided progression requests",
  "/api/next-step": "Refinery progress banner (RefineryLaneHeader)",
  "/api/workspace-context": "Refinery workspace header (RefineryLaneHeader)",
  "/api/resource-lists": "saving a resource list is a Refinery tool",
  "/api/sharing/join-prompt": "organization sharing prompt; a seatless account has no organization",
  "/api/dev/impersonate": "platform admins only, and an admin always has a seat",
  "/api/org/brand/": "an organization's logo, for its own members (OrgMark); a seatless account has no organization, and the Forge and /access render the monogram without calling it",
};

function matchesList(list: Readonly<Record<string, string>>, path: string): boolean {
  return Object.keys(list).some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/** May a seatless account call this API route? */
export function seatExemptApi(path: string): boolean {
  return (
    termsExemptApi(path) ||
    isForgeAnonymousApiRoute(path) ||
    isForgeSignedOutApi(path) ||
    matchesList(SEAT_EXEMPT_API, path)
  );
}

/** May a seatless account open this Refinery page? */
export function seatExemptPage(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEAT_EXEMPT_PAGES, path);
}

/**
 * Does this session pass? Open sign-ups pass everyone (the default, so
 * applying migration 096 changes nothing). Closed: only a seat passes. A claim
 * never read (undefined) passes at the edge, and the AI admission check, which
 * reads the database on every call, is the backstop for that window.
 */
export function seatClaimPasses(open: unknown, seat: unknown): boolean {
  return open !== false || seat === true;
}

/**
 * The edge verdict, beside termsGateVerdict and in the same shape:
 *  - "page": a Refinery page (not SEAT_EXEMPT_PAGES) goes to SEAT_PAGE;
 *  - "api":  an /api route outside seatExemptApi gets 403 seatRequired;
 *  - "pass": everything else, and everyone when seatClaimPasses.
 */
export function seatGateVerdict(path: string, open: unknown, seat: unknown): "pass" | "page" | "api" {
  if (seatClaimPasses(open, seat)) return "pass";
  if (isRefineryPage(path)) return seatExemptPage(path) ? "pass" : "page";
  if (path.startsWith("/api/") && !seatExemptApi(path)) return "api";
  return "pass";
}

/** How long a session trusts its seat answer before reading it again. */
export const SEAT_RECHECK_SECONDS = 24 * 60 * 60;
/** A "no seat" answer is read again sooner, so a new seat shows up within the hour. */
export const SEAT_RECHECK_NO_SEAT_SECONDS = 60 * 60;

/**
 * Read the seat claim again? On sign-in and update() (the seat page calls it
 * after a code or an accepted offer), when never read, hourly while the answer
 * is "closed and no seat", and at least daily otherwise. Mirrors
 * termsNeedsReread (lib/terms.ts).
 */
export function seatNeedsReread(t: {
  trigger?: string;
  seatOpen: unknown;
  seat: unknown;
  seatAt: unknown;
  now: number;
}): boolean {
  if (t.trigger === "signIn" || t.trigger === "signUp" || t.trigger === "update") return true;
  if (typeof t.seatOpen !== "boolean" || typeof t.seat !== "boolean") return true;
  if (typeof t.seatAt !== "number" || !Number.isFinite(t.seatAt)) return true;
  const ttl = t.seatOpen === false && t.seat === false ? SEAT_RECHECK_NO_SEAT_SECONDS : SEAT_RECHECK_SECONDS;
  return t.now - t.seatAt > ttl;
}

/**
 * The seat rule's last part: the database answer, or an address on the
 * PARTNER_PRE_AUTH list whose inbox the account has PROVEN (users.
 * email_proof_source, set only by a real email-link, matched Google or reset
 * proof; a password sign-up and 068's backfill never set it). Security review 1, SF-4: otherwise registering a
 * listed address nobody has claimed yet would be a seat. Self-set tier,
 * progression and premium grants, and any browser value are never inputs.
 */
export function seatFrom(
  dbSeat: boolean,
  email: unknown,
  inboxProven: boolean,
  preAuthRaw: string | undefined | null = process.env.PARTNER_PRE_AUTH
): boolean {
  return dbSeat === true || (inboxProven === true && isPartnerPreAuthorized(email, preAuthRaw));
}

/** A browser session that is signed in, past sign-ups, without a seat. For page copy only. */
export function seatlessSession(user: { seatOpen?: unknown; seat?: unknown } | null | undefined): boolean {
  return !!user && user.seatOpen === false && user.seat !== true;
}

/**
 * A link into the Refinery, for a seatless account, goes to the seat page with
 * the link as its return address; every other link is unchanged. Used by the
 * Forge start, finish and output pages so nobody is bounced off a wall.
 */
export function seatAwareHref(href: string, seatless: boolean): string {
  if (!seatless) return href;
  const path = href.split(/[?#]/)[0];
  if (!isRefineryPage(path) || seatExemptPage(path)) return href;
  return `${SEAT_PAGE}?callbackUrl=${encodeURIComponent(href)}`;
}

/**
 * AI workflows the Forge runs, which a seatless account keeps. Every other AI
 * workflow (ai-operation-policy.ts AI_WORKFLOWS) needs a seat once sign-ups
 * are closed. 'assistant' is t.ROY's chat on the Forge and the public pages;
 * the Refinery chat is 'coach' and is gated.
 */
export const FORGE_AI_WORKFLOWS: ReadonlySet<string> = new Set([
  "assistant",
  "analyze",
  "parse",
  "story-check",
  "forge-package-story",
  "generate-docs",
  "forge-resume-assist",
  "forge-suggest-fix",
  "forge-recheck",
  "second-check",
  "rush-resume",
]);

/** The AI admission verdict for one call. Pure; the server reads the inputs. */
export function seatAdmissionVerdict(input: { workflow: string; open: boolean; seat: boolean }): "pass" | "refuse" {
  if (FORGE_AI_WORKFLOWS.has(input.workflow)) return "pass";
  if (input.open) return "pass";
  return input.seat ? "pass" : "refuse";
}
