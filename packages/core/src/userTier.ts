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
 * Is this person a platform administrator?
 *
 * Reads platform_admin, which the application role can SELECT and nothing
 * else (migration 047). `users.tier = 'admin'` agrees with this by database
 * trigger, so the two cannot drift -- but authorization asks the table that
 * cannot be written from here, not the cached column that can.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const row = await getOne<{ user_id: string }>(
    `SELECT user_id FROM platform_admin WHERE user_id = $1`,
    [userId]
  );
  return !!row;
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
         WHEN 'unlimited' THEN 1
         WHEN 'partner' THEN 2
         WHEN 'client' THEN 3
       END
     LIMIT 1`,
    [userId]
  );

  // Map 'unlimited' to 'partner' for display tier (unlimited is a rate-limit concept).
  // 'client'-tier codes (cohort seats) deliberately do NOT elevate role -- the
  // seat-holder keeps the client journey; only their rate limit changes.
  const codeTier = row?.tier;
  // A CODE CAN NEVER MAKE AN ADMIN. It once could: an 'admin'-tier code was
  // copied straight into users.tier here, and users.tier is what the platform
  // admin gate read. Admin is now a row in platform_admin (migration 047); the
  // database pins those people to 'admin' whatever this writes, and refuses
  // 'admin' for anyone else.
  let effectiveTier: UserTier = "client";
  if (codeTier === "unlimited" || codeTier === "partner") effectiveTier = "partner";

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
