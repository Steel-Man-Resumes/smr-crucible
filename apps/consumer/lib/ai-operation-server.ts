import { randomUUID } from 'node:crypto';
import { getOneAsUser, queryAsUser, runAsUser } from '@crucible/core';
import { checkPremium } from './premium-server';
import { isAiWorkflow, type ToolPolicy } from './ai-operation-policy';
import { withAiOperation, type OperationContext } from './ai-operation-context';
import type { AiCallMeta } from './ai-usage-log';

const refuse = (code: string, error: string, status: number) => Response.json({code,error}, {status});
export async function readToolPolicy(userId: string, workflow: string): Promise<ToolPolicy | null> {
  return getOneAsUser<ToolPolicy>(userId,'SELECT * FROM ai_tool_policy WHERE workflow = $1',[workflow]);
}
export interface OperationHandle {
  response?: Response;
  meta: AiCallMeta;
  context: OperationContext;
  finish(status: 'succeeded' | 'failed'): Promise<void>;
}
/** Atomic admission across serverless instances. Policy is empty by default;
 * existing daily quotas and sponsorship continue to be enforced by callers.
 * Stuck operations retain their reservation until reviewed: a crashed request
 * must not turn an unknown provider bill into new spendable budget. */
export async function beginAiOperation(input: {userId: string; endpoint: string}): Promise<OperationHandle> {
  const id = randomUUID();
  const context: OperationContext = {operationId:id, ...input, pending:[]};
  const result: OperationHandle = {meta:{...input,operationId:id},context,finish:async()=>{}};
  if (!isAiWorkflow(input.endpoint)) return result;
  try {
    const policy = await readToolPolicy(input.userId,input.endpoint);
    if (policy?.disabled) { result.response=refuse('tool_paused','This tool is paused. Your saved work is still available.',403);return result; }
    if (policy?.premium_tool) {
      const locked = await checkPremium(input.userId,policy.premium_tool);
      if (locked) {result.response=locked;return result;}
    }
    const rows = await runAsUser<unknown[][]>(input.userId,sql=>[
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 873))`,
      sql`INSERT INTO ai_operation (id,user_id,workflow,reserved_usd)
        SELECT ${id}::uuid,${input.userId}::uuid,${input.endpoint},${policy?.reserve_usd ?? 0}::numeric
        WHERE (${policy?.daily_calls ?? null}::integer IS NULL OR
          (SELECT count(*) FROM ai_operation WHERE user_id=${input.userId}::uuid
           AND workflow=${input.endpoint} AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${policy?.daily_calls ?? null}::integer)
        AND (${policy?.daily_usd ?? null}::numeric IS NULL OR
          COALESCE((SELECT SUM(GREATEST(o.reserved_usd,
            COALESCE((SELECT SUM(t.cost_usd) FROM ai_token_usage t WHERE t.operation_id=o.id),0)))
            FROM ai_operation o WHERE o.user_id=${input.userId}::uuid AND o.workflow=${input.endpoint}
              AND o.created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)
          + ${policy?.reserve_usd ?? 0}::numeric <= ${policy?.daily_usd ?? null}::numeric)
        RETURNING id`,
    ]);
    if (!rows[1]?.length) {result.response=refuse('tool_allowance_used','This tool has reached its current allowance. Your saved work is still available.',429);return result;}
    let finished=false;
    result.finish=async(status)=>{
      if(finished)return;finished=true;
      await Promise.allSettled(context.pending);
      try {
        await queryAsUser(input.userId,`UPDATE ai_operation SET status=$3,finished_at=now(),
          reserved_usd=CASE WHEN NOT $4::boolean AND EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=ai_operation.id)
            AND NOT EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=ai_operation.id AND t.cost_status NOT IN ('priced','estimated'))
            THEN 0 ELSE reserved_usd END
          WHERE id=$1 AND user_id=$2 AND status='running'`,[id,input.userId,status,!!context.accountingIncomplete]);
      } catch { console.error('AI_OPERATION_FINISH_FAILED'); }
    };
    return result;
  } catch {
    result.response=refuse('tool_policy_unavailable','Access could not be checked. Try again shortly. Your saved work is still available.',503);
    return result;
  }
}
export async function runAiOperation(input: {userId: string;endpoint: string}, handler:()=>Promise<Response>): Promise<Response> {
  if(!isAiWorkflow(input.endpoint))return handler();
  const operation=await beginAiOperation(input);
  if(operation.response)return operation.response;
  return withAiOperation(operation.context,async()=>{
    try {
      const response=await handler();
      await operation.finish(response.ok?'succeeded':'failed');
      return response;
    } catch(error) {await operation.finish('failed');throw error;}
  });
}
