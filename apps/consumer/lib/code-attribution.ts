/**
 * The access-code cookie (set by /access?code=, or by anyone with
 * document.cookie) binds a signed-in account with no membership to that code
 * on first tool use and at registration. That is a code try like any other
 * (security review 1, SF-1), so it is budgeted (lib/access-code-guard.ts
 * cookieAttemptLimits: the per-IP budget shared with typed codes, its own
 * small per-account budget, and one try per code per account per hour, so a
 * stale cookie never eats the tries a person needs at /seat; review 2 N-13)
 * and is silent either way.
 *
 * An account that already belongs to an organization spends nothing: first
 * code wins, so the cookie can no longer change anything for it, and a
 * long-lived cookie must not burn a real person's tries.
 */
import { ensureUserAttribution, getOneAsUser } from "@crucible/core";
import { checkAuthRateLimits } from "./auth-rate-limit";
import { CODE_SHAPE, cookieAttemptLimits } from "./access-code-guard";

export interface CookieAttributionDeps {
  hasMembership: (userId: string) => Promise<boolean>;
  spendTry: (ip: string, userId: string, code: string) => Promise<boolean>;
  attribute: (userId: string, code: string) => Promise<boolean>;
}

export const defaultCookieAttributionDeps: CookieAttributionDeps = {
  hasMembership: async (userId) =>
    !!(await getOneAsUser(userId, "SELECT id FROM access_code_redemption WHERE user_id = $1 LIMIT 1", [userId])),
  spendTry: async (ip, userId, code) => (await checkAuthRateLimits(cookieAttemptLimits(ip, userId, code))).allowed,
  attribute: ensureUserAttribution,
};

/** Bind from the cookie, within the try budget. Returns whether it bound. Never throws. */
export async function attributeFromCookie(
  ip: string,
  userId: string,
  rawCode: string,
  deps: CookieAttributionDeps = defaultCookieAttributionDeps
): Promise<boolean> {
  try {
    const code = rawCode.trim().toUpperCase();
    if (!userId || !CODE_SHAPE.test(code)) return false;
    if (await deps.hasMembership(userId)) return false;
    if (!(await deps.spendTry(ip, userId, code))) return false;
    return await deps.attribute(userId, code);
  } catch {
    return false;
  }
}
