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
