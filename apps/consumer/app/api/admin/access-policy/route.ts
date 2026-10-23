import { requirePlatformAdmin } from '@/lib/org-guard';
import { isSameOriginJsonPost } from '@/lib/same-origin';
import { validProgressionPolicy } from '@/lib/progression-policy';
import { queryAsUser } from '@crucible/core';
export async function POST(request:Request){if(!isSameOriginJsonPost(request.headers))return Response.json({error:'Request not allowed.'},{status:403});const g=await requirePlatformAdmin();if(!g.ok)return g.response;
 try{const text=await request.text();if(text.length>2000)return Response.json({error:'Request too long.'},{status:413});const p=JSON.parse(text);if(!validProgressionPolicy(p))return Response.json({error:'Check the allowance limits.'},{status:400});
 await queryAsUser(g.userId,`UPDATE progression_policy SET starter_calls=$1,tailored_calls=$2,applied_calls=$3,bonus_calls=$4,bonus_daily_cap=$5,bonus_monthly_cap=$6,daily_usd=$7,reserve_usd=$8,updated_by=$9,change_history=change_history || jsonb_build_array(jsonb_build_object('at',now(),'by',$9::uuid,'previous',to_jsonb(progression_policy)-'change_history')),updated_at=now() WHERE id=true`,[p.starter_calls,p.tailored_calls,p.applied_calls,p.bonus_calls,p.bonus_daily_cap,p.bonus_monthly_cap,p.daily_usd,p.reserve_usd,g.userId]);return Response.json({ok:true});}catch{return Response.json({error:'Limits were not saved.'},{status:503});}}
