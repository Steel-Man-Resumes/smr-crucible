/**
 * Rate limiting for consumer AI endpoints.
 * Per-user (Refinery) and per-IP (Forge) daily counters.
 * Stored in ai_usage table with atomic upsert.
 */

import { query, getOne } from "./db";
import { HEADSHOT_GENERATE_ENDPOINT, HEADSHOT_DAILY_CAP } from "./avatarAssetShared";

export const DEFAULT_DAILY_LIMIT = 30;

/**
 * Per-endpoint HARD daily ceilings for authenticated users. Unlike the tier
 * daily limit (getUserDailyLimit), a hard cap here applies to EVERY user
 * regardless of tier -- including admin/unlimited -- because the endpoint is
 * an expensive paid operation that must never be spammed. An endpoint absent
 * from this map is governed solely by the tier limit (existing behavior).
 *
 * headshot_generate: AI headshot generation is a real paid image call, capped
 * at a few per day even for unlimited-tier accounts.
 */
export const USER_ENDPOINT_HARD_CAPS: Record<string, number> = {
  [HEADSHOT_GENERATE_ENDPOINT]: HEADSHOT_DAILY_CAP,
};

export const FORGE_IP_LIMITS: Record<string, number> = {
  analyze: 5,
  parse: 10,
  assistant: 20,
  "rush-resume": 5,
  "generate-docs": 5,
  // The bullet workshop is the most call-intensive pre-auth surface: a
  // suggest_tools per modal open + a write_bullet per generation, so a single
  // user building one resume easily makes 20-40 calls. It needs a far higher
  // per-IP/day ceiling than the one-shot endpoints. NOTE: this is per-IP, so
  // shared IPs (reentry-program labs, libraries) share it -- raise it further
  // for those contexts if users report being cut off.
  "forge-resume-assist": 100,
  // Deterministic docx build (no AI cost) -- generous cap, bounded so the
  // public route can't be used as a free compute endpoint.
  "forge-download": 100,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Check if a user has remaining AI calls for today.
 */
export async function checkUserRateLimit(
  userId: string,
  endpoint: string
): Promise<RateLimitResult> {
  const tierLimit = await getUserDailyLimit(userId);

  // A hard per-endpoint cap (if any) applies to every user, even unlimited-tier
  // accounts (tierLimit === 0). It is a ceiling: the effective limit is the
  // smaller of the tier limit and the hard cap, treating 0 (unlimited) as
  // "no tier ceiling" so the hard cap alone governs.
  const hardCap = USER_ENDPOINT_HARD_CAPS[endpoint];
  const limit =
    hardCap === undefined
      ? tierLimit
      : tierLimit === 0
        ? hardCap
        : Math.min(tierLimit, hardCap);

  const row = await getOne<{ call_count: number }>(
    `SELECT call_count FROM ai_usage
     WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`,
    [userId, endpoint]
  );

  const used = row?.call_count ?? 0;
  // limit 0 means unlimited (admin/unlimited tier)
  const allowed = limit === 0 || used < limit;
  const remaining = limit === 0 ? 999999 : Math.max(0, limit - used);

  return { allowed, remaining, limit };
}

/**
 * Check if an IP has remaining AI calls for today.
 */
export async function checkIpRateLimit(
  ip: string,
  endpoint: string
): Promise<RateLimitResult> {
  const limit = FORGE_IP_LIMITS[endpoint] ?? 10;

  const row = await getOne<{ call_count: number }>(
    `SELECT call_count FROM ai_usage
     WHERE ip_address = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE`,
    [ip, endpoint]
  );

  const used = row?.call_count ?? 0;
  const allowed = used < limit;
  const remaining = Math.max(0, limit - used);

  return { allowed, remaining, limit };
}

/**
 * Atomic increment for user-based usage. Returns the new count.
 */
export async function incrementUserUsage(
  userId: string,
  endpoint: string
): Promise<number> {
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (user_id, endpoint, usage_date, call_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [userId, endpoint]
  );
  return row?.call_count ?? 1;
}

/**
 * Pure cap decision for a reserved slot: the increment RETURNING count is within
 * the cap iff it is <= cap. Extracted so the ok/count sequence is unit-testable
 * without a DB (see rateLimit.test.ts): counts 1,2,3 against cap 3 are ok, the
 * 4th (count 4) is not.
 */
export function slotWithinCap(count: number, cap: number): boolean {
  return count <= cap;
}

/**
 * ATOMIC reserve-a-slot for a hard-capped, PAID endpoint (fixes the TOCTOU where
 * a separate check-then-increment let N concurrent callers each read used < cap
 * before any increment and blow past a paid ceiling).
 *
 * This is a SINGLE atomic statement: the upsert increments call_count and RETURNs
 * the post-increment value, so concurrent callers are serialized by the row lock
 * and each receives a DISTINCT count (1, 2, 3, ...). Only the first `cap` callers
 * get ok:true; every caller past the cap gets ok:false and MUST NOT make the paid
 * call. The extra increment for a rejected caller is harmless -- they are capped
 * out anyway, and the counter simply reads a little past the cap for the day.
 *
 * Matches incrementUserUsage's table/columns/usage_date handling exactly; the
 * only addition is returning the ok verdict alongside the count.
 */
export async function reserveEndpointSlot(
  userId: string,
  endpoint: string,
  cap: number
): Promise<{ ok: boolean; count: number }> {
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (user_id, endpoint, usage_date, call_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (user_id, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [userId, endpoint]
  );
  const count = row?.call_count ?? 1;
  return { ok: slotWithinCap(count, cap), count };
}

/**
 * Refund a slot previously taken by reserveEndpointSlot, for when the paid
 * operation FAILED -- a failed attempt must not cost the user one of their few
 * daily slots. Atomic decrement with a floor of 0 (GREATEST); a no-op if there is
 * no row for today. Call ONLY on a failure path after a successful reserve, never
 * after a success (that would hand back a slot the user actually consumed).
 */
export async function releaseEndpointSlot(
  userId: string,
  endpoint: string
): Promise<void> {
  await getOne(
    `UPDATE ai_usage
        SET call_count = GREATEST(call_count - 1, 0), updated_at = now()
      WHERE user_id = $1 AND endpoint = $2 AND usage_date = CURRENT_DATE
      RETURNING call_count`,
    [userId, endpoint]
  );
}

/**
 * Atomic increment for IP-based usage. Returns the new count.
 */
export async function incrementIpUsage(
  ip: string,
  endpoint: string
): Promise<number> {
  const row = await getOne<{ call_count: number }>(
    `INSERT INTO ai_usage (ip_address, endpoint, usage_date, call_count)
     VALUES ($1, $2, CURRENT_DATE, 1)
     ON CONFLICT (ip_address, endpoint, usage_date)
     DO UPDATE SET call_count = ai_usage.call_count + 1, updated_at = now()
     RETURNING call_count`,
    [ip, endpoint]
  );
  return row?.call_count ?? 1;
}

/**
 * Resolve the daily limit for a user based on their redeemed access codes.
 * Highest tier wins: admin > unlimited > partner > default.
 */
export async function getUserDailyLimit(userId: string): Promise<number> {
  const row = await getOne<{ tier: string; daily_limit: number | null }>(
    `SELECT ac.tier, ac.daily_limit
     FROM access_code_redemption acr
     JOIN access_code ac ON ac.id = acr.access_code_id
     WHERE acr.user_id = $1
       AND ac.is_active = true
       AND (ac.expires_at IS NULL OR ac.expires_at > now())
     ORDER BY
       CASE ac.tier
         WHEN 'admin' THEN 0
         WHEN 'unlimited' THEN 1
         WHEN 'partner' THEN 2
         WHEN 'client' THEN 3
       END
     LIMIT 1`,
    [userId]
  );

  if (!row) return DEFAULT_DAILY_LIMIT;
  if (row.tier === "admin" || row.tier === "unlimited") return 0; // 0 = unlimited
  // 'partner' and 'client' codes both carry their minted daily_limit
  return row.daily_limit ?? 200;
}

/**
 * Get total AI usage for a user today (across all AI endpoints).
 *
 * Non-AI counters that piggy-back on the ai_usage table (e.g. the vault's
 * "vault_upload" per-day upload ceiling, Phase 6.2) are EXCLUDED here: this
 * number is surfaced to the user via /api/usage as their AI calls used/remaining,
 * and a justice-impacted client must never see saving a document to their vault
 * as burning their AI allowance. The exclusion is display-only -- per-endpoint
 * enforcement (incrementUserUsage vs getUserDailyLimit) is unaffected, and real
 * AI endpoints are untouched.
 *
 * Phase 7.7: photo UPLOADS (endpoint "headshot_upload") are likewise excluded --
 * saving a photo is not an AI call. That endpoint is NOT prefixed "vault_", so it
 * needs its own explicit exclusion clause here. AI headshot GENERATION
 * ("headshot_generate") IS a real AI call and is deliberately NOT excluded, so it
 * DOES count toward the displayed AI usage.
 */
export async function getUserDailyUsage(userId: string): Promise<number> {
  const row = await getOne<{ total: string }>(
    `SELECT COALESCE(SUM(call_count), 0) as total
     FROM ai_usage
     WHERE user_id = $1 AND usage_date = CURRENT_DATE
       AND endpoint NOT LIKE 'vault_%'
       AND endpoint <> 'headshot_upload'`,
    [userId]
  );
  return parseInt(row?.total ?? "0", 10);
}
