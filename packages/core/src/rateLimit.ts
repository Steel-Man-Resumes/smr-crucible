/**
 * Rate limiting for consumer AI endpoints.
 * Per-user (Refinery) and per-IP (Forge) daily counters.
 * Stored in ai_usage table with atomic upsert.
 */

import { query, getOne } from "./db";

export const DEFAULT_DAILY_LIMIT = 30;

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
  const limit = await getUserDailyLimit(userId);

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
       END
     LIMIT 1`,
    [userId]
  );

  if (!row) return DEFAULT_DAILY_LIMIT;
  if (row.tier === "admin" || row.tier === "unlimited") return 0; // 0 = unlimited
  return row.daily_limit ?? 200;
}

/**
 * Get total usage for a user today (across all endpoints).
 */
export async function getUserDailyUsage(userId: string): Promise<number> {
  const row = await getOne<{ total: string }>(
    `SELECT COALESCE(SUM(call_count), 0) as total
     FROM ai_usage
     WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
    [userId]
  );
  return parseInt(row?.total ?? "0", 10);
}
