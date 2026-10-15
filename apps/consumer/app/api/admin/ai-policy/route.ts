import { isSameOriginJsonPost } from '@/lib/same-origin';
import { queryAsUser } from '@crucible/core';
import { requirePlatformAdmin } from '@/lib/org-guard';
import { AI_WORKFLOWS, parseToolPolicy } from '@/lib/ai-operation-policy';
export async function GET() {
  const guard=await requirePlatformAdmin();if(!guard.ok)return guard.response;
  try {return Response.json({workflows:AI_WORKFLOWS,policies:await queryAsUser(guard.userId,'SELECT *,daily_usd::float8 AS daily_usd,reserve_usd::float8 AS reserve_usd FROM ai_tool_policy ORDER BY workflow')});}
  catch {return Response.json({error:'Policy storage is unavailable.'},{status:503});}
}
export async function PUT(request: Request) {
  const guard=await requirePlatformAdmin();if(!guard.ok)return guard.response;
  if(!isSameOriginJsonPost(request.headers))return Response.json({error:'Invalid request'},{status:403});
  const raw=await request.json().catch(()=>null);
  const policy=parseToolPolicy(raw);
  if(!policy)return Response.json({error:'Invalid policy. A spend allowance requires a positive per-operation reservation.'},{status:400});
  try {
    const rows=await queryAsUser(guard.userId,`INSERT INTO ai_tool_policy
      (workflow,disabled,daily_calls,daily_usd,reserve_usd,premium_tool,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workflow) DO UPDATE SET
      disabled=excluded.disabled,daily_calls=excluded.daily_calls,daily_usd=excluded.daily_usd,
      reserve_usd=excluded.reserve_usd,premium_tool=excluded.premium_tool,updated_by=excluded.updated_by,updated_at=now()
      RETURNING workflow,disabled,daily_calls,daily_usd::float8,reserve_usd::float8,premium_tool`,[
      policy.workflow,policy.disabled,policy.daily_calls,policy.daily_usd,policy.reserve_usd,policy.premium_tool,guard.userId]);
    return Response.json({policy:rows[0]});
  } catch {return Response.json({error:'Policy was not saved.'},{status:503});}
}
