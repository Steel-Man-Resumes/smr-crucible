/**
 * Access code management for partner organizations.
 * Partners distribute codes to clients for higher rate limits.
 */

import { query, getOne } from "./db";
import { emitEvent } from "./events";

export interface AccessCode {
  id: string;
  code: string;
  partner_name: string;
  tier: "partner" | "unlimited" | "admin";
  daily_limit: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface AccessCodeRedemption {
  id: string;
  user_id: string;
  access_code_id: string;
  redeemed_at: string;
}

interface CreateAccessCodeOpts {
  code: string;
  partnerName: string;
  tier?: "partner" | "unlimited" | "admin";
  dailyLimit?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  createdBy?: string | null;
}

/**
 * Create a new access code for a partner organization.
 */
export async function createAccessCode(
  opts: CreateAccessCodeOpts
): Promise<AccessCode> {
  const rows = await query<AccessCode>(
    `INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      opts.code,
      opts.partnerName,
      opts.tier ?? "partner",
      opts.dailyLimit ?? 200,
      opts.maxRedemptions ?? null,
      opts.expiresAt ?? null,
      opts.createdBy ?? null,
    ]
  );

  await emitEvent({
    org_id: "00000000-0000-0000-0000-000000000000",
    project_id: null,
    run_id: null,
    step_id: null,
    event_type: "ACCESS_CODE_CREATED",
    severity: "info",
    actor_type: "admin",
    actor_user_id: opts.createdBy ?? null,
    actor_label: null,
    data_classification: "internal",
    retention_class: "long",
    correlation_id: null,
    parent_event_id: null,
    payload: { code: opts.code, partner: opts.partnerName, tier: opts.tier ?? "partner" },
    sensitive_ref: null,
  });

  return rows[0];
}

/**
 * Validate an access code — check active, not expired, not maxed out.
 */
export async function validateAccessCode(
  code: string
): Promise<{ valid: boolean; reason?: string; accessCode?: AccessCode }> {
  const ac = await getOne<AccessCode>(
    `SELECT * FROM access_code WHERE code = $1`,
    [code]
  );

  if (!ac) return { valid: false, reason: "Code not found" };
  if (!ac.is_active) return { valid: false, reason: "Code is no longer active" };
  if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
    return { valid: false, reason: "Code has expired" };
  }
  if (ac.max_redemptions && ac.times_redeemed >= ac.max_redemptions) {
    return { valid: false, reason: "Code has reached its limit" };
  }

  return { valid: true, accessCode: ac };
}

/**
 * Redeem an access code for a user.
 */
export async function redeemAccessCode(
  userId: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const validation = await validateAccessCode(code);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const ac = validation.accessCode!;

  // Check if already redeemed by this user
  const existing = await getOne(
    `SELECT id FROM access_code_redemption WHERE user_id = $1 AND access_code_id = $2`,
    [userId, ac.id]
  );
  if (existing) {
    return { success: false, error: "You've already used this code" };
  }

  // Insert redemption + increment counter
  await query(
    `INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`,
    [userId, ac.id]
  );
  await query(
    `UPDATE access_code SET times_redeemed = times_redeemed + 1, updated_at = now() WHERE id = $1`,
    [ac.id]
  );

  await emitEvent({
    org_id: "00000000-0000-0000-0000-000000000000",
    project_id: null,
    run_id: null,
    step_id: null,
    event_type: "ACCESS_CODE_REDEEMED",
    severity: "info",
    actor_type: "user",
    actor_user_id: userId,
    actor_label: null,
    data_classification: "internal",
    retention_class: "long",
    correlation_id: null,
    parent_event_id: null,
    payload: { code: ac.code, partner: ac.partner_name, tier: ac.tier },
    sensitive_ref: null,
  });

  return { success: true };
}

/**
 * Get all access codes redeemed by a user (for settings page display).
 */
export async function getUserAccessCodes(
  userId: string
): Promise<(AccessCode & { redeemed_at: string })[]> {
  return query<AccessCode & { redeemed_at: string }>(
    `SELECT ac.*, acr.redeemed_at
     FROM access_code_redemption acr
     JOIN access_code ac ON ac.id = acr.access_code_id
     WHERE acr.user_id = $1
     ORDER BY acr.redeemed_at DESC`,
    [userId]
  );
}
