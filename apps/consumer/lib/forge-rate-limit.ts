/**
 * Daily limits for the Forge's API routes (withRateLimit mode "forge").
 *
 * Signed in: the count follows the ACCOUNT, so ten people on one library or
 * program network no longer share one person's allowance. Per-IP stays as the
 * floor under it, with a ceiling sized for a shared network, so one machine
 * cannot open account after account and multiply the allowance without end.
 *
 * Signed out: per IP, exactly as before (the cohort code pool and the team's
 * live-test bucket included). Once the wall is up, a signed-out call reaches
 * this only on a route on the signed-out allowlist; any other is refused here
 * too, as a second lock behind the middleware.
 *
 * Pure: the wrapper does the counting.
 */

/** How many people one network's IP ceiling is sized for, for signed-in use. */
export const SIGNED_IN_IP_FLOOR_PEOPLE = 10;

export type ForgeLimitPlan =
  | { kind: "account"; userId: string; perAccount: number | null; ipCeiling: number }
  | { kind: "ip"; perIp: number }
  | { kind: "refuse" };

export function planForgeLimit(input: {
  /** The signed-in, fully verified user (forgeSessionUser), or null. */
  userId: string | null;
  /** This route needs a session now (forgeApiNeedsSession). */
  needsSession: boolean;
  /** The per-person daily limit for this endpoint (FORGE_IP_LIMITS). */
  perPerson: number;
  /** The account's tier limit: 0 means unlimited (admin, unlimited tier). */
  tierLimit: number;
}): ForgeLimitPlan {
  if (input.userId) {
    return {
      kind: "account",
      userId: input.userId,
      // Unlimited tiers keep their exemption from the per-account count; the
      // IP floor still applies to everyone.
      perAccount: input.tierLimit === 0 ? null : input.perPerson,
      ipCeiling: input.perPerson * SIGNED_IN_IP_FLOOR_PEOPLE,
    };
  }
  if (input.needsSession) return { kind: "refuse" };
  return { kind: "ip", perIp: input.perPerson };
}

/** Over the limit when the count AFTER this call is above the limit. */
export function overLimit(countAfterThisCall: number, limit: number | null): boolean {
  return limit !== null && countAfterThisCall > limit;
}
