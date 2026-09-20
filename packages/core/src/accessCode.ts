/**
 * Access code management for partner organizations.
 * Partners distribute codes to clients for higher rate limits.
 */

import { query, getOne, queryAsUser, runAsUser } from "./db";
import { emitEvent } from "./events";
import { syncUserTierFromCodes } from "./userTier";

export interface AccessCode {
  id: string;
  code: string;
  partner_name: string;
  /** 'client' = cohort seat code: grants daily_limit + the code-shared Forge
   *  bucket WITHOUT elevating role (seat-holders keep the client journey). */
  tier: "client" | "partner" | "unlimited";
  daily_limit: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
  partner_user_id: string | null;
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
  tier?: "client" | "partner" | "unlimited";
  dailyLimit?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  createdBy?: string | null;
  partnerUserId?: string | null;
}

/**
 * Create a new access code for a partner organization.
 */
export async function createAccessCode(
  opts: CreateAccessCodeOpts
): Promise<AccessCode> {
  const rows = await query<AccessCode>(
    `INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions, expires_at, created_by, partner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      opts.code,
      opts.partnerName,
      opts.tier ?? "partner",
      opts.dailyLimit ?? 200,
      opts.maxRedemptions ?? null,
      opts.expiresAt ?? null,
      opts.createdBy ?? null,
      opts.partnerUserId ?? null,
    ]
  );

  // Fire-and-forget -- event table requires a real org FK; don't let a missing
  // sentinel org row prevent code creation.
  emitEvent({
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
  }).catch(() => {});

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
    return { valid: false, reason: "This code's seats are all taken -- ask your organization for another code" };
  }

  return { valid: true, accessCode: ac };
}

/** What the database said about a redemption attempt. Only "ok" wrote anything. */
export type RedeemOutcome =
  | "ok"
  | "already_member"
  | "full"
  | "expired"
  | "inactive"
  | "not_found";

const REDEEM_ERRORS: Record<Exclude<RedeemOutcome, "ok">, string> = {
  already_member: "You've already used this code",
  full: "This code's seats are all taken -- ask your organization for another code",
  expired: "Code has expired",
  inactive: "Code is no longer active",
  not_found: "Code not found",
};

/**
 * Redeem an access code for a user. THE ONLY WAY a membership row is created.
 *
 * The rules -- code exists, is active, has not expired, has a seat left, and
 * this person does not already hold it -- are enforced by `smr_redeem_code` in
 * the database, under a row lock on the code, in one transaction. The
 * application role has no INSERT on access_code_redemption at all, so there is
 * no second path that could skip one of them. (Migration 048 says why.)
 *
 * `actorUserId` is who is DOING this when it is not the person themselves (an
 * org admin inviting someone). It is recorded by the audit trigger and changes
 * nothing about what is allowed.
 */
export async function redeemAccessCode(
  userId: string,
  code: string,
  opts: { actorUserId?: string } = {}
): Promise<{ success: boolean; error?: string; outcome: RedeemOutcome }> {
  const out = await runAsUser<[{ outcome: RedeemOutcome }[]]>(
    opts.actorUserId || userId,
    (sql) => [sql`SELECT smr_redeem_code(${userId}::uuid, ${code}) AS outcome`]
  );
  const outcome = out[0]?.[0]?.outcome ?? "not_found";
  if (outcome !== "ok") {
    return { success: false, error: REDEEM_ERRORS[outcome] ?? "Could not redeem that code", outcome };
  }

  const ac = (await getOne<AccessCode>(`SELECT * FROM access_code WHERE code = $1`, [code]))!;

  emitEvent({
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
  }).catch(() => {});

  // Sync tier to user record (highest code tier wins)
  await syncUserTierFromCodes(userId);

  return { success: true, outcome };
}

/**
 * Remove a person from every organization they belong to (delete-my-data).
 *
 * Goes through the database function rather than a DELETE because leaving is
 * more than one row: the person's staff assignments go too. Before this, the
 * membership was deleted and the assignment stayed, so a case manager's
 * caseload kept counting somebody who had left. Seats are NOT refunded: a
 * redemption is a durable seat (Troy, 2026-06-10).
 *
 * Returns how many memberships ended, so a caller can tell "left two orgs"
 * from "was in none" instead of reporting success either way.
 */
export async function leaveAllOrgs(userId: string): Promise<number> {
  const out = await runAsUser<[{ n: number }[]]>(userId, (sql) => [
    sql`SELECT smr_leave_all_orgs(${userId}::uuid) AS n`,
  ]);
  return Number(out[0]?.[0]?.n ?? 0);
}

/**
 * Get all access codes redeemed by a user (for settings page display).
 */
export async function getUserAccessCodes(
  userId: string
): Promise<(AccessCode & { redeemed_at: string })[]> {
  // Your own memberships: read AS you, or row-level security returns nothing.
  return queryAsUser<AccessCode & { redeemed_at: string }>(
    userId,
    `SELECT ac.*, acr.redeemed_at
     FROM access_code_redemption acr
     JOIN access_code ac ON ac.id = acr.access_code_id
     WHERE acr.user_id = $1
     ORDER BY acr.redeemed_at DESC`,
    [userId]
  );
}
