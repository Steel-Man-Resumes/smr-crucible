import { query } from '@crucible/core';
import { recordTokenUsage } from './ai-usage-log';
import { REALTIME_MODEL } from './voice-instructions';
/** Closing the lease and writing usage are separate operations. Recover an
 * interrupted write from the durable lease, bounded and idempotent. Old calls
 * are excluded because their legacy accounting has no deduplication key. */
export async function reconcileClosedVoiceUsage(): Promise<number> {
  const rows=await query<{id:string;user_id:string;seconds:number;ended_reason:string|null;call_id:string|null}>(`
    SELECT v.id,v.user_id,v.ended_reason,v.call_id,
      greatest(0,least(v.reserved_seconds,round(extract(epoch FROM(v.ended_at-v.started_at)))))::int AS seconds
    FROM voice_session v WHERE v.status <> 'active' AND v.ended_at IS NOT NULL
      AND v.started_at >= (SELECT applied_at FROM _migrations WHERE filename='087_ai_operation_accounting.sql')
      AND NOT EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.event_key='voice:'||v.id::text)
    ORDER BY v.ended_at LIMIT 100`);
  for(const row of rows) await recordTokenUsage('openai',REALTIME_MODEL,{inputTokens:0,outputTokens:0,audioSeconds:row.seconds},
    {userId:row.user_id,endpoint:'interview-voice',eventKey:`voice:${row.id}`,outcome:row.ended_reason==='provider_error'?'failed':'unknown',
      usageMissing:row.ended_reason==='provider_error' || !row.call_id || row.call_id==='pending'});
  return rows.length;
}
