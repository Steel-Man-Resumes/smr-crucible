/**
 * User tier management.
 * Tier is cached on the users table for fast session reads.
 * Source of truth for code-based upgrades: access_code_redemption table.
 */

import { query, getOne } from "./db";

export type UserTier = "client" | "partner" | "observer" | "admin";

const TIER_PRIORITY: Record<string, number> = {
  admin: 0,
  unlimited: 1,
  partner: 2,
  client: 3,
  observer: 4,
};

/**
 * Get cached tier from users table.
 */
export async function getUserTier(userId: string): Promise<UserTier> {
  const row = await getOne<{ tier: string }>(
    `SELECT tier FROM users WHERE id = $1`,
    [userId]
  );
  return (row?.tier as UserTier) || "client";
}

/**
 * Set tier directly on user record.
 * Does NOT validate against access codes — use syncUserTierFromCodes for that.
 */
export async function setUserTier(
  userId: string,
  tier: UserTier
): Promise<void> {
  await query(`UPDATE users SET tier = $1 WHERE id = $2`, [tier, userId]);
}

/**
 * Recalculate tier from access_code_redemption and update user record.
 * Returns the new effective tier.
 */
export async function syncUserTierFromCodes(
  userId: string
): Promise<UserTier> {
  const row = await getOne<{ tier: string }>(
    `SELECT ac.tier
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

  // Map 'unlimited' to 'partner' for display tier (unlimited is a rate-limit concept)
  const codeTier = row?.tier;
  let effectiveTier: UserTier = "client";
  if (codeTier === "admin") effectiveTier = "admin";
  else if (codeTier === "unlimited" || codeTier === "partner")
    effectiveTier = "partner";

  await setUserTier(userId, effectiveTier);
  return effectiveTier;
}

/**
 * Resolve effective tier — highest wins.
 * Used when merging audience selection with code-based tier.
 */
export function resolveEffectiveTier(
  codeTier: UserTier | null,
  audienceTier: UserTier | null
): UserTier {
  const a = codeTier ? (TIER_PRIORITY[codeTier] ?? 4) : 4;
  const b = audienceTier ? (TIER_PRIORITY[audienceTier] ?? 4) : 4;

  if (a <= b) return codeTier || "client";
  return audienceTier || "client";
}
