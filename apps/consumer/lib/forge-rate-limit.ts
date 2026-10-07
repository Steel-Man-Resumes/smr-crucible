/**
 * Daily limits for the Forge's API routes (withRateLimit mode "forge").
 *
 * Signed in: the count follows the ACCOUNT, so ten people on one library or
 * program network no longer share one person's allowance. Per-IP stays as the
 * floor under it, with a ceiling sized for a shared network, so one machine
 * cannot open account after account and multiply the allowance without end.
 *
 * Order matters (security review 3a r1, M2): the account is checked FIRST,
 * and only a call the account allows is counted against the network. An
 * account past its own limit then spends nothing of anyone else's, so one
 * person cannot lock a library or a lab out of a tool for the day. Someone who
 * came in through an organization's access code draws on that code's seat
 * pool (per person x seats, as signed-out cohort use always has) instead of
 * the flat network ceiling, so a full lab is sized by the seats it was given.
 *
 * Signed out: per IP, exactly as before (the cohort code pool and the team's
 * live-test bucket included). Once the wall is up, a signed-out call reaches
 * this only on a route on the signed-out allowlist; any other is refused here
 * too, as a second lock behind the middleware.
 *
 * Pure apart from the counters it is handed: the wrapper passes the real
 * (database) ones, the tests pass in-memory ones.
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

/** Seats a valid access code sizes its pool by: its max redemptions, 1 to 50 (default 10). Same rule as signed-out cohort use. */
export function codeSeats(maxRedemptions: number | null | undefined): number {
  return Math.min(Math.max(maxRedemptions ?? 10, 1), 50);
}

export interface ForgeCounters {
  /** Count one call for this account and endpoint today; returns the new count. */
  account(userId: string, endpoint: string): Promise<number>;
  /** Count one call in a shared bucket (an IP, or a code's pool) today; returns the new count. */
  bucket(key: string, endpoint: string): Promise<number>;
}

export type SignedInVerdict = "ok" | "account" | "network" | "code";

/**
 * One signed-in call: the account first, then (only if the account allows it)
 * the code's seat pool when the person came through a valid code, otherwise
 * the network ceiling. Returns which limit, if any, refused it.
 */
export async function decideSignedInCall(
  input: {
    plan: Extract<ForgeLimitPlan, { kind: "account" }>;
    endpoint: string;
    perPerson: number;
    ip: string;
    /** A valid access code carried by this person, with its seats. */
    code: { code: string; seats: number } | null;
  },
  counters: ForgeCounters
): Promise<SignedInVerdict> {
  const n = await counters.account(input.plan.userId, input.endpoint);
  if (overLimit(n, input.plan.perAccount)) return "account";
  const signedIn = `signed-in:${input.endpoint}`;
  if (input.code) {
    const pooled = await counters.bucket(`code:${input.code.code}`, signedIn);
    return overLimit(pooled, input.perPerson * input.code.seats) ? "code" : "ok";
  }
  const network = await counters.bucket(input.ip, signedIn);
  return overLimit(network, input.plan.ipCeiling) ? "network" : "ok";
}
