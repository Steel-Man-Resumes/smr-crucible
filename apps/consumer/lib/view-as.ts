/**
 * Developer view-as for organization routes: the pure rules (house lane L2,
 * 2026-10-26). No Next.js imports, so every rule is unit-tested
 * (lib/__tests__/view-as.test.ts) and the edge middleware can share them.
 *
 * WHAT WENT WRONG (A1 defect B2). The shell, /api/user/role and
 * /api/partner/org served the person being viewed (effectiveAuth), while
 * every /api/org/* route asked the REAL session (auth()). Viewing a demo case
 * manager drew their organization's sidebar around the admin's own
 * organization's Today, notes and team: two organizations on one screen.
 *
 * THE RULES NOW.
 *  1. An org route resolves the member through the EFFECTIVE session. During
 *     view-as that is the person being viewed, so every org screen shows
 *     their organization, inside their reach, with their capabilities.
 *  2. Under view-as (blue "view" or red "assist") an org route serves READS
 *     ONLY: GET and HEAD. Anything else is refused at the route with
 *     VIEW_AS_REFUSAL, whatever the middleware did first. Assist mode is for
 *     helping a job seeker with their own account; it never acts as staff.
 *  3. Under view-as the admin's own platform powers never apply: no cross-org
 *     override (orgId / ?codeId), no "act for this org".
 *  4. A route that does not say what kind of request it is gets treated as a
 *     write (fail closed): it simply refuses under view-as.
 * effectiveAuth (lib/effective-auth.ts) still decides whether a view-as
 * session exists at all: a signed 60-minute cookie for view, 30 for assist,
 * honored only for the platform admin named in it, re-checked against
 * platform_admin and the admin's second factor on every request.
 */

export const VIEW_AS_REFUSAL =
  "Changes are off while you view as someone. End the view to make changes.";

export const ORG_READ_ONLY_REFUSAL =
  "This is a read-only view of another organization. Changes are off here.";

/** The request methods that only read. Everything else is a write. */
export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function isReadMethod(method: string | null | undefined): boolean {
  return !!method && READ_METHODS.has(method.toUpperCase());
}

export interface SessionLike {
  user?: { id?: string | null; tier?: string | null } | null;
  impersonation?: { mode?: string | null; adminId?: string | null; sid?: string | null } | null;
}

export type OrgIdentity =
  | { ok: true; userId: string; viewing: boolean; mayUsePlatformPowers: boolean }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Who an org route acts as.
 *
 * @param effective  effectiveAuth(): the viewed person during view-as, else the real session
 * @param method     the request method, or null when the route did not pass its request
 */
export function orgRouteIdentity(effective: SessionLike | null | undefined, method: string | null | undefined): OrgIdentity {
  const userId = effective?.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Not signed in." };
  const viewing = !!effective?.impersonation;
  if (viewing && !isReadMethod(method)) return { ok: false, status: 403, error: VIEW_AS_REFUSAL };
  return { ok: true, userId, viewing, mayUsePlatformPowers: !viewing };
}

/**
 * The admin "view an organization" console (/dashboard/partner?codeId=) and
 * /api/partner/org. That view is read-only (A1 defect H1): a write that names
 * another organization, or any write during view-as, is refused.
 */
export function partnerOrgWriteRefusal(input: { viewing: boolean; codeId: string | null | undefined }): string | null {
  if (input.viewing) return VIEW_AS_REFUSAL;
  if (input.codeId) return ORG_READ_ONLY_REFUSAL;
  return null;
}

/**
 * Exports (CSV) are refused during view-as: viewing is looking, not taking a
 * copy of an organization's people away.
 */
export function viewAsExportRefusal(viewing: boolean, format: string | null | undefined): string | null {
  return viewing && format === "csv" ? "Downloads are off while you view as someone." : null;
}

/**
 * POSTs (and other non-read methods) that only READ and may run during a
 * blue "view" session. EMPTY ON PURPOSE (house lane L2, A1 M1). Each POST a
 * viewed screen sends was checked, and none is a pure read that is safe to
 * run as someone else:
 *   /api/paths            computes paths, but revisionCaller refuses any
 *                         view-as anyway; the page's first load is a GET
 *   /api/next-step-why    calls an AI model (cost, the person's data)
 *   /api/revisions/check  POST saves a revision (its read is a GET)
 *   /api/assistant        t.ROY: calls an AI model and writes the chat
 *   /api/auth/*           sign-in plumbing, never blocked (see below)
 * Adding a path here needs a test that its POST handler writes nothing and
 * calls no model (lib/__tests__/view-as.test.ts pins this list).
 */
export const VIEW_MODE_READ_POSTS: readonly string[] = [];

/**
 * Does a blue "view" session's request get refused at the edge? Used by
 * middleware.ts after it verifies the cookie says mode "view". Every org
 * route also refuses on its own (orgRouteIdentity), so a route never
 * depends on the edge alone.
 */
export function viewModeBlocks(method: string, pathname: string): boolean {
  if (isReadMethod(method) || method.toUpperCase() === "OPTIONS") return false;
  if (!pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/api/auth")) return false;
  // Ending (DELETE) or replacing (POST) the view itself must always work.
  if (pathname === "/api/dev/impersonate") return false;
  if (VIEW_MODE_READ_POSTS.includes(pathname)) return false;
  return true;
}
