import { NextResponse } from 'next/server';
import { revisionCaller } from '@/lib/revision-route';
import { isSameOriginJsonPost } from '@/lib/same-origin';
import { getOneAsUser, queryAsUser, listArtifacts, incrementUserUsage } from '@crucible/core';
import { readMasterDraft, isMasterResume } from '@/lib/master-draft';
export const dynamic = 'force-dynamic';
export async function GET() {
  const caller=await revisionCaller();if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status});const userId=caller.userId;
  const [row,artifacts]=await Promise.all([getOneAsUser<{master:unknown}>(userId,"SELECT profile_data->'masterDraft' AS master FROM consumer_profile WHERE user_id=$1",[userId]),listArtifacts(userId,{type:'resume',limit:100,examples:'hide'})]);
  const candidates=artifacts.filter(isMasterResume);
  const base=candidates.find(a=>a.is_current)||candidates.find(a=>a.target_context?.source==='forge')||candidates[0];
  return NextResponse.json({master:readMasterDraft(row?.master),base:base?{id:base.id}:null},{headers:{'Cache-Control':'no-store'}});
}
export async function PUT(request:Request) {
  if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:'Open this page from Refinery.'},{status:403});
  const caller=await revisionCaller();if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status});const userId=caller.userId;
  if(Number(request.headers.get('content-length')||0)>40000)return NextResponse.json({error:'Keep up to 40 short work details.'},{status:413});
  if(await incrementUserUsage(userId,'master-draft-save')>100)return NextResponse.json({error:'Your work is safe. Try saving more details tomorrow.'},{status:429});
  const raw=await request.text();if(raw.length>40000)return NextResponse.json({error:'Keep up to 40 short work details.'},{status:413});
  let body;try{body=JSON.parse(raw);}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
  if(!Number.isInteger(body?.revision)||body.revision<0||!Array.isArray(body?.facts)||body.facts.length>40)return NextResponse.json({error:'Reload your Master Draft before saving.'},{status:400});
  if(body.facts.some((f:unknown)=>{if(!f||typeof f!=='object')return true;const fact=f as Record<string,unknown>;return typeof fact.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(fact.id)||typeof fact.text!=='string'||!fact.text.trim()||fact.text.length>700||!['confirmed','needs_check'].includes(String(fact.status));})||new Set(body.facts.map((f:{id:string})=>f.id)).size!==body.facts.length)return NextResponse.json({error:'Each detail needs its own ID, up to 700 characters, and a confirmation status.'},{status:400});
  const master=readMasterDraft(body);master.revision++;
  const rows=await queryAsUser(userId,`INSERT INTO consumer_profile(user_id,profile_data)
    SELECT $1,jsonb_build_object('masterDraft',$2::jsonb) WHERE $3::int=0 OR EXISTS(SELECT 1 FROM consumer_profile WHERE user_id=$1)
    ON CONFLICT(user_id) DO UPDATE SET profile_data=COALESCE(consumer_profile.profile_data,'{}'::jsonb)||jsonb_build_object('masterDraft',$2::jsonb),updated_at=now()
    WHERE COALESCE((consumer_profile.profile_data->'masterDraft'->>'revision')::int,0)=$3::int RETURNING user_id`,[userId,JSON.stringify(master),body.revision]);
  if(!rows.length)return NextResponse.json({error:'Your Master Draft changed in another window. Reload before saving so those details are kept.'},{status:409});
  return NextResponse.json({master},{headers:{'Cache-Control':'no-store'}});
}
