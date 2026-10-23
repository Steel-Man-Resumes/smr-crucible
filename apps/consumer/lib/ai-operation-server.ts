import { progressionAllowance } from './progression-server';
import { countsForProgression } from './progression-policy';
import { randomUUID } from 'node:crypto';
import { getOneAsUser, queryAsUser, runAsUser } from '@crucible/core';
import { checkPremium } from './premium-server';
import { isAiWorkflow, type ToolPolicy } from './ai-operation-policy';
import { withAiOperation, type OperationContext } from './ai-operation-context';
import type { AiCallMeta } from './ai-usage-log';

const refuse = (code: string, error: string, status: number) => Response.json({code,error}, {status});
export async function readToolPolicy(userId: string, workflow: string): Promise<ToolPolicy | null> {
  return getOneAsUser<ToolPolicy>(userId,'SELECT *,daily_usd::float8 AS daily_usd,reserve_usd::float8 AS reserve_usd FROM ai_tool_policy WHERE workflow = $1',[workflow]);
}
export interface OperationHandle {
  response?: Response;
  meta: AiCallMeta;
  context: OperationContext;
  finish(status: 'succeeded' | 'failed'): Promise<void>;
}
/** Atomic admission across serverless instances. Policy is empty by default;
 * existing daily quotas and sponsorship continue to be enforced by callers.
 * Under a dollar allowance an ESTIMATED cost (voice) counts at its estimate;
 * only UNPRICED usage (unknown model or missing usage) closes the day, since
 * its bill is unknown.
 * Stuck operations retain their reservation until reviewed: a crashed request
 * must not turn an unknown provider bill into new spendable budget. */
export async function beginAiOperation(input: {userId: string; endpoint: string; legacyOverage?: boolean}): Promise<OperationHandle> {
  const id = randomUUID();
  const context: OperationContext = {operationId:id, ...input, pending:[]};
  const result: OperationHandle = {meta:{...input,operationId:id},context,finish:async()=>{}};
  if (!isAiWorkflow(input.endpoint)) return result;
  let admissionStage = 'policy';
  try {
    const policy = await readToolPolicy(input.userId,input.endpoint);
    admissionStage = 'progression';
    const progress = countsForProgression(input.endpoint) ? await progressionAllowance(input.userId) : null;
    const newAccount = !!progress && !progress.account.existing;
    const reserve = Math.max(policy?.reserve_usd ?? 0, newAccount ? progress!.policy.reserve_usd : 0);
    if (policy?.disabled) { result.response=refuse('tool_paused','This tool is paused. Your saved work is still available.',403);return result; }
    if (policy?.premium_tool) {
      const locked = await checkPremium(input.userId,policy.premium_tool);
      if (locked) {result.response=locked;return result;}
    }
    admissionStage = 'reservation';
    const rows = await runAsUser<unknown[][]>(input.userId,sql=>[
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 873))`,
      sql`INSERT INTO ai_operation (id,user_id,workflow,reserved_usd,progression_counted,progression_bonus_used)
        SELECT ${id}::uuid,${input.userId}::uuid,${input.endpoint},${reserve}::numeric,${!!progress},${!!input.legacyOverage}
        WHERE (${policy?.daily_calls ?? null}::integer IS NULL OR
          (SELECT count(*) FROM ai_operation WHERE user_id=${input.userId}::uuid
           AND workflow=${input.endpoint} AND status<>'failed' AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${policy?.daily_calls ?? null}::integer)
        AND (${policy?.daily_usd ?? null}::numeric IS NULL OR (
          NOT EXISTS (SELECT 1 FROM ai_token_usage t WHERE t.user_id=${input.userId}::uuid
            AND t.endpoint=${input.endpoint} AND t.operation_id IS NULL
            AND t.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            AND t.cost_status = 'unpriced')
          AND NOT EXISTS (SELECT 1 FROM ai_operation o
            WHERE o.user_id=${input.userId}::uuid AND o.workflow=${input.endpoint}
              AND o.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
              AND NOT o.provider_not_called AND o.reserved_usd=0 AND (o.status='running' OR o.accounting_incomplete
                OR NOT EXISTS (SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id)
                OR EXISTS (SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id AND t.cost_status = 'unpriced')))
          AND COALESCE((SELECT SUM(GREATEST(o.reserved_usd,
            COALESCE((SELECT SUM(t.cost_usd) FROM ai_token_usage t WHERE t.operation_id=o.id),0)))
            FROM ai_operation o WHERE o.user_id=${input.userId}::uuid AND o.workflow=${input.endpoint}
              AND o.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)
          + COALESCE((SELECT SUM(t.cost_usd) FROM ai_token_usage t
              WHERE t.user_id=${input.userId}::uuid AND t.endpoint=${input.endpoint} AND t.operation_id IS NULL
                AND t.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)
          + ${reserve}::numeric <= ${policy?.daily_usd ?? null}::numeric))
        AND (${!newAccount}::boolean OR (
          (SELECT count(*) FROM ai_operation WHERE user_id=${input.userId}::uuid AND progression_counted AND status<>'failed'
           AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${progress ? progress.base+progress.bonus : 0}
          AND NOT EXISTS(SELECT 1 FROM ai_operation o WHERE o.user_id=${input.userId}::uuid AND o.progression_counted
           AND o.created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           AND (o.accounting_incomplete OR EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id AND t.cost_status='unpriced')))
          AND COALESCE((SELECT sum(GREATEST(o.reserved_usd,COALESCE((SELECT sum(t.cost_usd) FROM ai_token_usage t WHERE t.operation_id=o.id),0)))
           FROM ai_operation o WHERE o.user_id=${input.userId}::uuid AND o.progression_counted
            AND o.created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${reserve} <= ${progress?.policy.daily_usd??0}
        ))
        AND (${!input.legacyOverage}::boolean OR
         (SELECT count(*) FROM ai_operation WHERE user_id=${input.userId}::uuid AND progression_bonus_used AND status<>'failed'
          AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${progress?.bonus??0})
        RETURNING id`,
    ]);
    if (!rows[1]?.length) {result.response=refuse('tool_allowance_used','Your current AI allowance or spending limit is reached. Ask t.ROY through the progress bar for more access, or return after midnight UTC. Your saved work is still available.',429);return result;}
    let finished=false;
    result.finish=async(status)=>{
      if(finished)return;finished=true;
      await Promise.allSettled(context.pending);
      try {
        await queryAsUser(input.userId,`UPDATE ai_operation SET status=$3,finished_at=now(),accounting_incomplete=$4,provider_not_called=$5,
          reserved_usd=CASE WHEN $5::boolean THEN 0 WHEN NOT $4::boolean AND EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=ai_operation.id)
            AND NOT EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=ai_operation.id AND t.cost_status <> 'priced')
            THEN 0 ELSE reserved_usd END
          WHERE id=$1 AND user_id=$2 AND status='running'`,[id,input.userId,status,!!context.accountingIncomplete,countsForProgression(input.endpoint)&&!context.providerAttempted&&!context.accountingIncomplete&&context.pending.length===0]);
      } catch { console.error('AI_OPERATION_FINISH_FAILED'); }
    };
    return result;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    console.error('AI_OPERATION_ADMISSION_FAILED', { stage: admissionStage, code: /^[A-Z0-9]{5}$/.test(code) ? code : 'unavailable' });
    result.response=refuse('tool_policy_unavailable','Access could not be checked. Try again shortly. Your saved work is still available.',503);
    return result;
  }
}
export async function runAiOperation(input: {userId: string;endpoint: string;legacyOverage?: boolean}, handler:()=>Promise<Response>, onSoftFailure?:()=>Promise<void>): Promise<Response> {
  if(!isAiWorkflow(input.endpoint))return handler();
  const operation=await beginAiOperation(input);
  if(operation.response)return operation.response;
  return withAiOperation(operation.context,async()=>{
    try {
      const response=await handler();
      await operation.finish(response.ok && !operation.context.failed ? 'succeeded' : 'failed');
      if(response.ok && operation.context.failed)await onSoftFailure?.();
      return response;
    } catch(error) {await operation.finish('failed');throw error;}
  });
}
