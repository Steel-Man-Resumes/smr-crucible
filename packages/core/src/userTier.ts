/**
 * User tier management.
 * Tier is cached on the users table for fast session reads.
 * Source of truth for code-based upgrades: access_code_redemption table.
 */

import { query, getOne, getOneAsUser } from "./db";

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
 * Recalculate the cached tier and write it to the user record. Returns it.
 *
 * The name is kept for its callers (redeem, accept an offer, leave), but since
 * migration 101 / house lane L2 (2026-10-26) the answer no longer comes from
 * codes at all:
 *
 *   partner  the person OWNS an active organization (access_code.partner_user_id)
 *            or holds an org_staff row in an active one;
 *   client   everyone else, whatever codes they redeemed.
 *
 * WHY. A 'partner' or 'unlimited' code used to make whoever redeemed it a
 * "partner", so the participants of three organizations got a partner landing
 * and a "Partner Dashboard" link instead of the job-seeker journey. Joining with
 * a code makes you a participant, never staff. Rate limits still come from the
 * code's own tier (rateLimit.ts reads access_code.tier directly), so a
 * participant of an unlimited code keeps their allowance.
 *
 * Tier is only a cached label now. The staff workspace is chosen from the org
 * role (apps/consumer lib/workspace.ts resolveWorkspace), never from this.
 * A CODE CAN NEVER MAKE AN ADMIN: admin is a platform_admin row (047), and the
 * database pins those people to 'admin' whatever this writes.
 */
export async function syncUserTierFromCodes(
  userId: string
): Promise<UserTier> {
  // Read AS the person: org_staff is row-level protected and lets someone
  // read their OWN rows, which is exactly the question.
  const row = await getOneAsUser<{ staff: boolean }>(
    userId,
    `SELECT (
        EXISTS (SELECT 1 FROM access_code ac
                 WHERE ac.partner_user_id = $1 AND ac.is_active = true)
     OR EXISTS (SELECT 1 FROM org_staff os
                  JOIN access_code ac ON ac.id = os.access_code_id
                 WHERE os.user_id = $1 AND ac.is_active = true)
     ) AS staff`,
    [userId]
  );

  const effectiveTier: UserTier = tierFromRoles({ holdsStaffRole: !!row?.staff });
  await setUserTier(userId, effectiveTier);
  return effectiveTier;
}

/**
 * The tier rule, pure (tested): partner only for someone who owns or works in
 * an active organization. Codes are not an input, on purpose.
 */
export function tierFromRoles(input: { holdsStaffRole: boolean }): UserTier {
  return input.holdsStaffRole ? "partner" : "client";
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
