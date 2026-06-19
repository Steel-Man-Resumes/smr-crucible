/**
 * Partner tracking -- the funder / compliance / governance spine.
 *
 * Two responsibilities:
 *  1. Attribution: bind a user to exactly ONE organization (first code wins),
 *     so every downstream metric isolates cleanly per org and can never be
 *     polluted by another org's data.
 *  2. Reporting: roll up per-org usage + outcomes into report-ready rows that
 *     get synced to Airtable (where Troy actually builds views/automations).
 *
 * No PII in the aggregate rows -- counts, rates, and timestamps only.
 */

import { query, getOne } from "./db";
import { redeemAccessCode } from "./accessCode";
import { getFunnelAggregate, type FunnelCounts } from "./outcomeAggregate";

/** A plausible access-code shape. Mirrors the cookie/regex guard elsewhere. */
function isCodeShape(code: string): boolean {
  return /^[A-Z0-9]{4,20}$/.test(code);
}

/**
 * Log one tool call against an organization's code. Fire-and-forget: tracking
 * must never break a user-facing request. Safe for anonymous (userId null).
 */
export async function logPartnerUsage(opts: {
  code: string;
  endpoint: string;
  userId?: string | null;
}): Promise<void> {
  const code = opts.code?.toUpperCase?.().trim();
  if (!code || !isCodeShape(code)) return;
  try {
    await query(
      `INSERT INTO partner_usage_event (code, user_id, endpoint) VALUES ($1, $2, $3)`,
      [code, opts.userId ?? null, opts.endpoint]
    );
  } catch {
    // swallow -- never let the usage ledger fail a request
  }
}

/**
 * Ensure a user is attributed to an org, idempotently. ISOLATION RULE: a user
 * binds to the FIRST org whose code they carry; later codes do not move them.
 * This is what makes "the data is separate and can never get polluted" true.
 * Returns true if the user is now attributed to `code` (newly or already).
 */
export async function ensureUserAttribution(
  userId: string,
  code: string
): Promise<boolean> {
  if (!userId || !code || !isCodeShape(code.toUpperCase())) return false;

  // First code wins: if the user already has ANY redemption, do not rebind.
  const existing = await getOne<{ id: string }>(
    `SELECT id FROM access_code_redemption WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (existing) return false;

  const res = await redeemAccessCode(userId, code.toUpperCase().trim());
  return res.success;
}

export interface OrgTrackingRow {
  code: string;
  partner_name: string;
  tier: string;
  is_active: boolean;
  seats_total: number | null;   // max_redemptions (null = unlimited)
  seats_used: number;           // times_redeemed
  attributed_users: number;     // distinct accounts bound to this org
  tool_calls: number;           // total rate-limited calls logged to this code
  funnel: FunnelCounts;
  forge_completion_rate: number; // completed / started (0..1)
  placement_rate: number;        // hires / applications (0..1)
  last_activity: string | null;  // ISO of most recent usage event
  created_at: string;
}

/**
 * Per-organization report rows. Combines the access_code registry, the
 * redemption-based outcome funnel, and the usage ledger into one row per org.
 */
export async function getPartnerTrackingRows(): Promise<OrgTrackingRow[]> {
  const codes = await query<{
    code: string;
    partner_name: string;
    tier: string;
    is_active: boolean;
    max_redemptions: number | null;
    times_redeemed: number;
    created_at: string;
  }>(
    `SELECT code, partner_name, tier, is_active, max_redemptions, times_redeemed, created_at
     FROM access_code ORDER BY created_at`,
    []
  );

  const rows = await Promise.all(
    codes.map(async (ac) => {
      const [funnel, usage] = await Promise.all([
        getFunnelAggregate({ partnerCode: ac.code }),
        getOne<{ tool_calls: string; attributed_users: string; last_activity: string | null }>(
          `SELECT
             COUNT(*)                              AS tool_calls,
             COUNT(DISTINCT user_id)               AS attributed_users,
             MAX(occurred_at)                      AS last_activity
           FROM partner_usage_event WHERE code = $1`,
          [ac.code]
        ),
      ]);

      const started = funnel.forge_sessions_started || 0;
      const completed = funnel.forge_sessions_completed || 0;
      const apps = funnel.applications_logged || 0;
      const hires = funnel.hires || 0;

      return {
        code: ac.code,
        partner_name: ac.partner_name,
        tier: ac.tier,
        is_active: ac.is_active,
        seats_total: ac.max_redemptions,
        seats_used: ac.times_redeemed || 0,
        attributed_users: parseInt(usage?.attributed_users ?? "0", 10),
        tool_calls: parseInt(usage?.tool_calls ?? "0", 10),
        funnel,
        forge_completion_rate: started > 0 ? +(completed / started).toFixed(3) : 0,
        placement_rate: apps > 0 ? +(hires / apps).toFixed(3) : 0,
        last_activity: usage?.last_activity ?? null,
        created_at: ac.created_at,
      };
    })
  );

  return rows;
}
