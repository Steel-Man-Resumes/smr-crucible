import { query, queryAsUser, runPerOrg, isPlatformAdmin } from '@crucible/core';
// Source rates, estimates, missing usage and old accounting stay inspectable.
const sums = `count(*)::int AS calls, COALESCE(sum(t.input_tokens),0)::bigint AS input_tokens,
 COALESCE(sum(t.output_tokens),0)::bigint AS output_tokens, COALESCE(sum(t.audio_seconds),0)::bigint AS audio_seconds,
 COALESCE(sum(t.cost_usd),0)::numeric(12,6) AS cost_usd,
 COALESCE(sum(t.cost_usd) FILTER (WHERE t.cost_status='estimated'),0)::numeric(12,6) AS estimated_usd,
 count(*) FILTER (WHERE t.cost_status='unpriced')::int AS unpriced_calls,
 count(*) FILTER (WHERE t.cost_status='legacy')::int AS legacy_calls,
 count(*) FILTER (WHERE t.outcome='failed')::int AS failed_calls`;
export async function getAiCostReport(userId: string, requestedDays = 30) {
  if (!(await isPlatformAdmin(userId))) throw new Error('OWNER_REQUIRED');
  const days=Math.min(365,Math.max(1,Math.floor(requestedDays)||30));
  const where=`t.created_at > now() - ($1 || ' days')::interval`;
    const [totals,perUser,perEndpoint,perWorkflow,operations,policies] = await Promise.all([
      query(`SELECT ${sums} FROM ai_token_usage t WHERE ${where}`,[String(days)]),
      query(`SELECT u.id AS user_id,COALESCE(u.name,'') AS name,COALESCE(u.email,'(pre-auth / anonymous)') AS email,${sums}
        FROM ai_token_usage t LEFT JOIN users u ON u.id=t.user_id WHERE ${where}
        GROUP BY u.id,u.name,u.email ORDER BY sum(t.cost_usd) DESC NULLS LAST LIMIT 200`,[String(days)]),
      query(`SELECT t.endpoint,${sums} FROM ai_token_usage t WHERE ${where}
        GROUP BY t.endpoint ORDER BY sum(t.cost_usd) DESC NULLS LAST`,[String(days)]),
      queryAsUser(userId,`SELECT COALESCE(o.workflow,'ungrouped') AS workflow,${sums}
        FROM ai_token_usage t LEFT JOIN ai_operation o ON o.id=t.operation_id WHERE ${where}
        GROUP BY o.workflow ORDER BY sum(t.cost_usd) DESC NULLS LAST`,[String(days)]),
      queryAsUser(userId,`SELECT workflow,status,count(*)::int AS operations,
        count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id))::int AS without_usage,
        count(*) FILTER (WHERE accounting_incomplete)::int AS incomplete_accounting,
        sum(reserved_usd)::numeric(12,6) AS reserved_usd FROM ai_operation o
        WHERE created_at > now()-($1 || ' days')::interval GROUP BY workflow,status`,[String(days)]),
      queryAsUser(userId,'SELECT workflow,disabled,daily_calls,daily_usd,reserve_usd,premium_tool FROM ai_tool_policy ORDER BY workflow'),
    ]);
    const orgs=await query<{id:string;partner_name:string}>('SELECT id,partner_name FROM access_code ORDER BY id');
    const orgUsage=await runPerOrg(orgs.map(o=>o.id),userId,`SELECT ${sums} FROM ai_token_usage t
      WHERE t.created_at > now()-($2 || ' days')::interval AND EXISTS
       (SELECT 1 FROM access_code_redemption r WHERE r.access_code_id=$1 AND r.user_id=t.user_id)`,id=>[id,String(days)]);
    const perOrg=orgs.map(o=>({org_id:o.id,name:o.partner_name,...orgUsage.get(o.id)?.[0]}));
    return {days,perOrg,totals:totals[0],perUser,perEndpoint,perWorkflow,operations,policies,
      pricingAsOf:'2026-10-15',note:'Recorded costs include estimates. Unpriced and legacy calls need reconciliation; totals are not an invoice.'};
}

/**
 * Usage per seat for one organization (platform admin only): every person
 * holding a seat in that organization's code, with their AI operations today
 * and over 30 days, the progression-counted ones, the cost (the same
 * GREATEST(reserved, recorded) expression the progression allowance uses), how
 * many have incomplete accounting, and the last AI activity. Read-only. The
 * membership rows are read scoped to that organization (runPerOrg); the
 * operations under the admin's own ai_operation policy (migration 087).
 */
const DAY_START = "date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";
export const SEAT_USAGE_SQL = `SELECT r.user_id, COALESCE(u.name,'') AS name, COALESCE(u.email,'') AS email, r.redeemed_at,
 (SELECT count(*)::int FROM ai_operation o WHERE o.user_id=r.user_id AND o.status<>'failed' AND o.created_at>=${DAY_START}) AS ops_today,
 (SELECT count(*)::int FROM ai_operation o WHERE o.user_id=r.user_id AND o.status<>'failed' AND o.created_at>now()-interval '30 days') AS ops_30d,
 (SELECT count(*)::int FROM ai_operation o WHERE o.user_id=r.user_id AND o.progression_counted AND o.status<>'failed' AND o.created_at>now()-interval '30 days') AS counted_30d,
 COALESCE((SELECT sum(GREATEST(o.reserved_usd,COALESCE((SELECT sum(t.cost_usd) FROM ai_token_usage t WHERE t.operation_id=o.id),0)))
   FROM ai_operation o WHERE o.user_id=r.user_id AND o.created_at>now()-interval '30 days'),0)::float8 AS cost_30d_usd,
 (SELECT count(*)::int FROM ai_operation o WHERE o.user_id=r.user_id AND o.created_at>now()-interval '30 days'
   AND (o.accounting_incomplete OR EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id AND t.cost_status='unpriced'))) AS incomplete_30d,
 (SELECT max(o.created_at) FROM ai_operation o WHERE o.user_id=r.user_id) AS last_ai_at
 FROM access_code_redemption r JOIN users u ON u.id=r.user_id
 WHERE r.access_code_id=$1 ORDER BY r.redeemed_at`;

export interface SeatUsageRow {
  user_id: string; name: string; email: string; redeemed_at: string;
  ops_today: number; ops_30d: number; counted_30d: number; cost_30d_usd: number; incomplete_30d: number; last_ai_at: string | null;
}

export async function getSeatUsage(adminId: string, orgId: string) {
  if (!(await isPlatformAdmin(adminId))) throw new Error('OWNER_REQUIRED');
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error('INVALID_ORG');
  const org = (await query<{ partner_name: string; times_redeemed: number; max_redemptions: number | null }>(
    'SELECT partner_name, times_redeemed, max_redemptions FROM access_code WHERE id=$1', [orgId]))[0];
  if (!org) throw new Error('INVALID_ORG');
  const rows = (await runPerOrg<SeatUsageRow>([orgId], adminId, SEAT_USAGE_SQL, (id) => [id])).get(orgId) ?? [];
  // Seats used is times_redeemed (durable seats), not the people here now.
  return { orgId, name: org.partner_name, seatsUsed: Number(org.times_redeemed), seatsMax: org.max_redemptions, seats: rows };
}
