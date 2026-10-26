/**
 * The code a person typed on the sign-in page (login/page.tsx stores it in
 * localStorage as "pending_access_code"), redeemed once the account is known.
 *
 * WHAT WENT WRONG (house lane L2, defect H5). The shell redeemed the stored
 * code on every mount for WHOEVER was signed in, before it knew who that was.
 * A platform admin who opened a ?code= link, or signed in on a browser where
 * someone had typed a code, silently became a participant of that
 * organization. In production an admin account became a participant of a
 * real organization this way.
 *
 * NOW. Nothing happens until the effective role has loaded. Then:
 *   drop    a platform admin, or any admin view-as / assist session (the code
 *           belongs to whoever typed it, never to the person being viewed):
 *           the stored code is removed and NOT redeemed;
 *   redeem  everyone else: removed, then redeemed through the one route,
 *           which also refuses admins and the organization's own staff
 *           (migration 101), so this is never the only check.
 *   wait    the role is still loading, or there is no code.
 * Pure (tested in lib/__tests__/pending-access-code.test.ts); the browser
 * part is lib/use-pending-access-code.ts.
 */

export const PENDING_ACCESS_CODE_KEY = "pending_access_code";

export type PendingCodeAction = "wait" | "drop" | "redeem";

export interface PendingCodeRole {
  /** The EFFECTIVE tier from /api/user/role (the viewed person's during view-as). */
  tier?: string | null;
  workspace?: string | null;
  impersonating?: { mode: string } | null;
}

/**
 * @param role       the effective role, or null while it loads
 * @param realTier   the signed-in account's own tier (useRealTier), so an
 *                   admin is recognised even while viewing as someone
 * @param code       the stored code, or null
 */
export function pendingCodeAction(role: PendingCodeRole | null | undefined, realTier: string | null | undefined, code: string | null | undefined): PendingCodeAction {
  if (!code || !code.trim()) return "wait";
  if (!role) return "wait";
  if (role.impersonating) return "drop";
  if (realTier === "admin" || role.tier === "admin" || role.workspace === "admin") return "drop";
  return "redeem";
}
