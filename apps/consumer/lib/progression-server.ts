import { provenanceCountsAsTailored } from '@crucible/core/src/applicationEvents';
import { workspaceNextAction } from './workspace-next-action';
import { randomUUID } from 'node:crypto';
import { buildJourneySnapshot, getOneAsUser, queryAsUser, runAsUser, getUserDailyLimit, getUserTier } from '@crucible/core';
import { encryptString, decryptString, type EncryptedPayload } from '@crucible/core/src/crypto';
import { loadSelectedWork, readWorkSelection, type WorkSelection } from './assistant-work-context';
import { PROGRESSION_STEPS, STEP_COPY, baseAllowance, isProgressionStep, type ProgressionPolicy, type ProgressionStep } from './progression-policy';

const DAY = "date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";
export async function readProgressionPolicy(userId:string):Promise<ProgressionPolicy> {
 const p=await getOneAsUser<ProgressionPolicy>(userId,'SELECT *,daily_usd::float8 AS daily_usd,reserve_usd::float8 AS reserve_usd FROM progression_policy WHERE id=true');
 if(!p)throw new Error('progression_unavailable'); return p;
}
// Migration 092 snapshots pre-launch users. Auth users have no created_at column;
// an absent snapshot is a new account, with explicit legacy entitlements retained.
export async function progressionAccount(userId:string) {
 const [account,tier,legacyLimit]=await Promise.all([
  getOneAsUser<{existing_access:boolean}>(userId,'SELECT existing_access FROM progression_account WHERE user_id=$1',[userId]),getUserTier(userId),getUserDailyLimit(userId),
 ]);
 return {existing:!!account?.existing_access || tier==='admin' || tier==='partner' || legacyLimit!==30,legacyLimit};
}
export async function progressionAllowance(userId:string) {
 const [policy,account,snapshot]=await Promise.all([readProgressionPolicy(userId),progressionAccount(userId),buildJourneySnapshot(userId)]);
 const row=await getOneAsUser<{bonus:number;used:number;bonusUsed:number;spent:number;unknown:boolean}>(userId,`SELECT
 COALESCE((SELECT sum(calls)::int FROM progression_grant WHERE user_id=$1 AND kind='bonus' AND expires_at>now()),0) AS bonus,
 (SELECT count(*)::int FROM ai_operation WHERE user_id=$1 AND progression_counted AND status<>'failed' AND created_at>=${DAY}) AS used,
 (SELECT count(*)::int FROM ai_operation WHERE user_id=$1 AND progression_bonus_used AND status<>'failed' AND created_at>=${DAY}) AS "bonusUsed",
 COALESCE((SELECT sum(GREATEST(o.reserved_usd,COALESCE((SELECT sum(t.cost_usd) FROM ai_token_usage t WHERE t.operation_id=o.id),0))) FROM ai_operation o WHERE o.user_id=$1 AND o.progression_counted AND o.created_at>=${DAY}),0)::float8 AS spent,
 EXISTS(SELECT 1 FROM ai_operation o WHERE o.user_id=$1 AND o.progression_counted AND o.created_at>=${DAY} AND (o.accounting_incomplete OR EXISTS(SELECT 1 FROM ai_token_usage t WHERE t.operation_id=o.id AND t.cost_status='unpriced'))) AS unknown`,[userId]);
 const earned=await getOneAsUser<{tailored:boolean;applied:boolean;steel:boolean}>(userId,"SELECT COALESCE(bool_or(grant_key='first-tailored'),false) AS tailored,COALESCE(bool_or(grant_key='first-applied'),false) AS applied,COALESCE(bool_or(grant_key='meter:steel-man'),false) AS steel FROM progression_grant WHERE user_id=$1 AND kind='milestone'",[userId]);
 // meter:steel-man is written only from server-recorded work (lib/steelman/moments.ts); policy.steel_man_bonus_calls ships 0.
 const base=account.existing?account.legacyLimit:baseAllowance(policy,{tailored:snapshot.metrics.resumeTailored||!!earned?.tailored,applied:snapshot.metrics.applicationsSent>0||!!earned?.applied,steelMan:!!earned?.steel});
 return {policy,account,snapshot,base,bonus:row?.bonus??0,used:row?.used??0,bonusUsed:row?.bonusUsed??0,blockedReason:!account.existing&&(row?.unknown||((row?.spent??0)+policy.reserve_usd>policy.daily_usd))?'Today’s AI spending allowance is reserved or used. Saved work and non-AI tools remain available. It resets at midnight UTC.':undefined};
}
export async function progressionLegacyBonus(userId:string):Promise<number> {
 const row=await getOneAsUser<{calls:number}>(userId,'SELECT COALESCE(sum(calls),0)::int AS calls FROM progression_grant WHERE user_id=$1 AND kind=\'bonus\' AND expires_at>now()',[userId]);
 return row?.calls??0;
}
interface Grant {id:string;grant_key:string;step_id:ProgressionStep;kind:string;label:string;created_at:string}
interface RequestRow {id:string;user_id:string;kind:string;step_id:ProgressionStep;status:string;decision_note:string|null;created_at:string;summary_encrypted:EncryptedPayload;idempotency_key:string;decision_history?:unknown[]}
function requestView(r:RequestRow,includeSummary=false){return {id:r.id,idempotencyKey:r.idempotency_key,stepId:r.step_id,kind:r.kind,status:r.status,decisionNote:r.decision_note,createdAt:r.created_at,decisionHistory:r.decision_history??[],...(includeSummary?{summary:decryptString(r.summary_encrypted,`${r.user_id}:access-request:${r.id}`)}:{})};}
async function syncMilestones(userId:string,metrics:{resumeTailored:boolean;applicationsSent:number;forgeComplete?:boolean;savedJobs?:number}) {
 if(metrics.forgeComplete&&(metrics.savedJobs??0)>0)await queryAsUser(userId,"INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label) VALUES($1,'earned:tailor','unlock','tailor','Tailoring tools earned') ON CONFLICT(user_id,grant_key) DO NOTHING",[userId]);
 for(const [earned,key,step,label] of [
  [metrics.resumeTailored,'first-tailored','tailor','You connected your experience to a real job.'],
  [metrics.applicationsSent>0,'first-applied','apply','You recorded your first application. Keep that packet ready.'],
 ] as const) if(earned)await queryAsUser(userId,`INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label) VALUES($1,$2,'milestone',$3,$4) ON CONFLICT(user_id,grant_key) DO NOTHING`,[userId,key,step,label]);
}
export async function getProgression(userId:string,selection:WorkSelection={},readOnly=false) {
 const [allow,work]=await Promise.all([progressionAllowance(userId),loadSelectedWork(userId,selection,true)]);
 if(!readOnly)await syncMilestones(userId,allow.snapshot.metrics);
 const [grants,requests]=await Promise.all([
  queryAsUser<Grant>(userId,'SELECT id,grant_key,step_id,kind,label,created_at FROM progression_grant WHERE user_id=$1 AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC',[userId]),
  queryAsUser<RequestRow>(userId,'SELECT * FROM progression_request WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',[userId]),
 ]);
 const anyOffer=await getOneAsUser(userId,"SELECT id FROM job_application WHERE user_id=$1 AND status IN ('offered','hired') LIMIT 1",[userId]);
 if(anyOffer&&!readOnly)await queryAsUser(userId,"INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label) VALUES($1,'earned:offer','unlock','offer','Offer tools earned') ON CONFLICT(user_id,grant_key) DO NOTHING",[userId]);
 const hasResume=!!work.revision || !!work.selection.artifactId || !!work.laneDocument?.text;
 const app=work.application;
 const applied=!!app && ['applied','interviewing','offered','hired','rejected'].includes(app.status);
 const interview=app?.status==='interviewing' || app?.status==='offered' || app?.status==='hired';
 const offered=app?.status==='offered'||app?.status==='hired';
 // A selected application must carry its own document. Account-wide achievements
 // can raise allowance but never stand in for this application's preparation.
 const tailored=!!app && !!work.applicationResumeSnapshot && provenanceCountsAsTailored(work.applicationResumeSnapshot.provenance);
 const complete:Record<ProgressionStep,boolean>={foundation:hasResume,direction:!!app,tailor:tailored,apply:applied,interview:!!offered,offer:!!offered};
 const ready:Record<ProgressionStep,boolean>={foundation:true,direction:true,tailor:allow.snapshot.metrics.forgeComplete&&allow.snapshot.metrics.savedJobs>0,apply:allow.snapshot.metrics.resumeTailored||grants.some(g=>g.kind==='milestone'&&g.step_id==='tailor'),interview:allow.snapshot.metrics.applicationsSent>0||interview||grants.some(g=>g.kind==='milestone'&&g.step_id==='apply'),offer:!!anyOffer};
 const current:ProgressionStep=offered?'offer':(interview&&!offered)||work.priorityApplication?'interview':PROGRESSION_STEPS.find(id=>!complete[id])??'direction';
 const suffix=app?`?applicationId=${encodeURIComponent(app.id)}`:'';
 const steps=PROGRESSION_STEPS.map(id=>{
  const early=grants.some(g=>g.kind==='unlock'&&g.step_id===id);
  const earnedAccess=grants.some(g=>g.kind==='unlock'&&g.step_id===id&&g.grant_key.startsWith('earned:'));
  const access=ready[id]||earnedAccess?'earned':allow.account.existing?'existing':early?'early':'locked';
  return {id,...STEP_COPY[id],href:STEP_COPY[id].href+(id==='tailor'&&app?`?job=${encodeURIComponent(app.id)}${work.selection.artifactId?`&id=${encodeURIComponent(work.selection.artifactId)}`:''}`:id==='interview'?suffix:''),state:complete[id]?'completed':current===id?'current':ready[id]?'available':'next',access,unlockable:access==='locked'};
 });
 const expiresAt=new Date();expiresAt.setUTCHours(24,0,0,0);
 const taskAction=workspaceNextAction({work});
 const bonusRemaining=Math.max(0,allow.bonus-allow.bonusUsed);
 const latest=grants.find(g=>g.kind==='milestone'&&!g.grant_key.startsWith('meter:'));// meter:* are internal markers, never a celebration
 return {contextKey:JSON.stringify(work.selection),steps,currentStepId:current,nextAction:taskAction??{label:STEP_COPY[current].label,href:steps.find(s=>s.id===current)!.href},
 nextReward:{label:allow.account.existing?'Earn progress celebrations and request a small AI bonus':allow.snapshot.metrics.applicationsSent>0?'Ask t.ROY for a small extra allowance':allow.snapshot.metrics.resumeTailored?'12 daily AI actions for new accounts':'10 daily AI actions for new accounts',requirement:allow.snapshot.metrics.resumeTailored?'Record your application when you send it.':'Save a resume tailored to a real job.'},
 allowance:{enabled:true,blockedReason:allow.blockedReason,remaining:allow.account.existing?null:Math.max(0,allow.base+allow.bonus-allow.used),unit:'AI actions',expiresAt:expiresAt.toISOString(),description:allow.account.existing?`Your existing per-tool allowance continues. ${bonusRemaining} extra AI actions are available across tools until midnight UTC.`:`${allow.base} daily Refinery AI actions${allow.bonus?` + ${allow.bonus} bonus`:''}. Resets at midnight UTC. Other tool and spending limits still apply.`,base:allow.base,bonus:allow.bonus},
 celebration:latest?{id:latest.id,title:'Work worth building on',detail:latest.label}:undefined,requests:requests.map(r=>requestView(r))};
}
export interface UnlockInput {stepId:unknown;reason:unknown;idempotencyKey:unknown;selection?:unknown;escalate?:boolean;consentToShare?:boolean;requestKind?:unknown;summary?:unknown}
export async function requestProgressionAccess(userId:string,input:UnlockInput){
 if(!isProgressionStep(input.stepId))throw new Error('invalid_step');
 const step=input.stepId;
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 const key=typeof input.idempotencyKey==='string'?input.idempotencyKey:'';
 const kind=input.requestKind??'unlock';
 if(!['unlock','ai_bonus','feedback','bug'].includes(String(kind))||reason.length<5||reason.length>1000||! /^[A-Za-z0-9_-]{8,100}$/.test(key))throw new Error('invalid_request');
 const selection=readWorkSelection(input.selection);
 const state=await getProgression(userId,selection);
 const prior=await getOneAsUser<RequestRow>(userId,'SELECT * FROM progression_request WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);
 if(prior){if(prior.kind!==kind||prior.step_id!==step)throw new Error('request_key_conflict');
  if(prior.status==='question' && input.escalate===true && input.consentToShare===true){
   const original=decryptString(prior.summary_encrypted,`${userId}:access-request:${prior.id}`);
   const revised=encryptString(`${original.slice(0,5000)}\nTroy asked: ${(prior.decision_note??'').slice(0,1000)}\nFollow-up: ${reason}`,`${userId}:access-request:${prior.id}`);
   const changed=await queryAsUser(userId,"UPDATE progression_request SET summary_encrypted=$3::jsonb,status='pending',decision_history=decision_history||jsonb_build_array(jsonb_build_object('status','pending','at',now(),'actor',user_id)) WHERE id=$1 AND user_id=$2 AND status='question' RETURNING id",[prior.id,userId,JSON.stringify(revised)]);
   if(!changed.length)return {outcome:'review_required',message:'This request changed while you replied. Refresh your requests to see the decision.'};
   return {outcome:'pending',message:'Your reply is saved for Troy to review.',requestId:prior.id};
  }
  if(prior.status==='approved'&&prior.kind!=='unlock'){
   const live=await getOneAsUser(userId,'SELECT id FROM progression_grant WHERE user_id=$1 AND grant_key=$2 AND expires_at>now()',[userId,`review:${prior.id}`]);
   if(!live)return {outcome:'denied',message:'This request was approved previously. That bonus has expired; check your current allowance in the progress bar.',requestId:prior.id};
  }
  return {outcome:prior.status==='approved'?'granted':prior.status==='denied'?'denied':'pending',message:prior.decision_note??'Your request is in the review queue.',requestId:prior.id};}
 if(kind==='unlock'&&!input.escalate){
  // This changes guided tool access only, never tier, premium access or completion.
  await queryAsUser(userId,`INSERT INTO progression_grant(user_id,grant_key,kind,step_id,label) VALUES($1,$2,'unlock',$3,$4) ON CONFLICT(user_id,grant_key) DO NOTHING`,[userId,`early:${step}`,step,`${STEP_COPY[step].label} opened at your request.`]);
  return {outcome:'granted',message:`${STEP_COPY[step].label} is open. The recommended preparation is still there when you need it.`};
 }
 if(kind==='ai_bonus'&&!input.escalate){
  const receipt=await getOneAsUser<{active:boolean}>(userId,'SELECT expires_at>now() AS active FROM progression_grant WHERE user_id=$1 AND request_key=$2',[userId,key]);
  if(receipt)return {outcome:receipt.active?'granted':'denied',message:receipt.active?'This request’s bonus was already added. Check the progress bar for your remaining allowance.':'This request’s bonus has expired. Check your current allowance in the progress bar.'};
  const metrics=(await buildJourneySnapshot(userId)).metrics;
  const candidates=[...(metrics.resumeTailored?['first-tailored']:[]),...(metrics.applicationsSent>0?['first-applied']:[])];
  for(const evidence of candidates){
   const earnedKey=`earned:${evidence}`;
   const claimed=await getOneAsUser(userId,'SELECT id FROM progression_grant WHERE user_id=$1 AND grant_key=$2',[userId,earnedKey]);
   if(!claimed && await grantBonus(userId,earnedKey,step,userId,key))return {outcome:'granted',message:'Your extra AI actions are ready until midnight UTC. Other tool and spending limits still apply.'};
  }
 }
 const summary=`${kind==='ai_bonus'?'Extra AI allowance':kind==='feedback'?'Private feedback':kind==='bug'?'Bug report':'Early access'}: ${STEP_COPY[step].label}\nReason: ${reason}\nCurrent step: ${state.currentStepId}. No conversation transcript is attached.`;
 if(input.escalate!==true||input.consentToShare!==true||input.summary!==summary)return {outcome:'review_required',message:'This needs Troy to review. Check the summary before sharing it.',summary};
 const id=randomUUID();
 const encrypted=encryptString(summary,`${userId}:access-request:${id}`);
 const rows=await runAsUser<unknown[][]>(userId,sql=>[
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 874))`,
  sql`INSERT INTO progression_request(id,user_id,idempotency_key,kind,step_id,summary_encrypted)
   SELECT ${id}::uuid,${userId}::uuid,${key},${kind as string},${step},${JSON.stringify(encrypted)}::jsonb
   WHERE (SELECT count(*) FROM progression_request WHERE user_id=${userId}::uuid AND status IN ('pending','question'))<3
    AND (SELECT count(*) FROM progression_request WHERE user_id=${userId}::uuid AND created_at>=now()-interval '30 days')<20
   ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,
 ]);
 if(!rows[1]?.length){const existing=await getOneAsUser<{id:string}>(userId,'SELECT id FROM progression_request WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);if(existing)return{outcome:'pending',message:'Your request is in the review queue.',requestId:existing.id};return {outcome:'denied',message:'Your existing requests are still being reviewed. You can keep using your available tools.'};}
 return {outcome:'pending',message:'Your request is in Troy’s review queue. You can keep working while it is reviewed.',requestId:id};
}
/** Same transaction lock serializes all bonus grants, including admin approvals. */
export async function grantBonus(userId:string,key:string,step:ProgressionStep,actorId=userId,requestKey:string|null=null){
 const p=await readProgressionPolicy(actorId);
 const rows=await runAsUser<unknown[][]>(actorId,sql=>[
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 874))`,
  sql`INSERT INTO progression_grant(user_id,grant_key,request_key,kind,step_id,calls,label,expires_at)
   SELECT ${userId}::uuid,${key},${requestKey},'bonus',${step},${p.bonus_calls},'Extra AI actions earned',date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day'
   WHERE COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${userId}::uuid AND kind='bonus' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${p.bonus_calls}<=${p.bonus_daily_cap}
    AND COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${userId}::uuid AND kind='bonus' AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${p.bonus_calls}<=${p.bonus_monthly_cap}
   ON CONFLICT DO NOTHING RETURNING id`,
 ]);
 if(rows[1]?.length)return true;
 return !!await getOneAsUser(actorId,'SELECT id FROM progression_grant WHERE user_id=$1 AND (request_key=$3 OR ($3::text IS NULL AND grant_key=$2)) AND expires_at>now()',[userId,key,requestKey]);
}
/** One page of Troy's queue, open requests first. `openTotal` lets the page say how many open requests are not on screen (review 1, N-6). */
export const ACCESS_REQUEST_PAGE=100;
export async function listAccessRequests(adminId:string,offset=0){const at=Math.max(0,Math.min(100000,Math.floor(offset)||0));const rows=await queryAsUser<RequestRow>(adminId,'SELECT * FROM progression_request ORDER BY (status IN (\'pending\',\'question\')) DESC,created_at DESC LIMIT $1 OFFSET $2',[ACCESS_REQUEST_PAGE,at]);return rows.map(r=>({...requestView(r,true),userId:r.user_id}));}
export async function countOpenAccessRequests(adminId:string){const r=await getOneAsUser<{n:number}>(adminId,"SELECT count(*)::int AS n FROM progression_request WHERE status IN ('pending','question')");return r?.n??0;}
export async function decideAccessRequest(adminId:string,id:string,decision:string,note:string,origin=process.env.APP_URL||''){
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['approve','deny','question'].includes(decision)||note.length>1000||note.trim().length<3)throw new Error('invalid_decision');
 const r=await getOneAsUser<RequestRow>(adminId,'SELECT * FROM progression_request WHERE id=$1',[id]);
 if(!r)throw new Error('request_not_found');
 // A seat request is decided by the seat path (createOrgInvite into Troy's own
 // organization), never by inserting a progression grant below.
 if(r.kind==='seat'){const {decideSeatRequest,defaultDecideSeatDeps}=await import('./refinery-access-server');return decideSeatRequest(adminId,r,decision,note,origin,defaultDecideSeatDeps());}
 if(r.status==='approved'||r.status==='denied')return {status:r.status};
 const p=await readProgressionPolicy(adminId);
 const status=decision==='approve'?'approved':decision==='deny'?'denied':'question';
 const results=await runAsUser<unknown[][]>(adminId,sql=>[
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${r.user_id}, 874))`,
  sql`INSERT INTO progression_grant(user_id,grant_key,kind,step_id,calls,label,expires_at)
   SELECT user_id,'review:'||id::text,CASE WHEN kind='unlock' THEN 'unlock' ELSE 'bonus' END,step_id,
    CASE WHEN kind='unlock' THEN 0 ELSE ${p.bonus_calls} END,'Approved after review',
    CASE WHEN kind='unlock' THEN NULL ELSE date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' END
   FROM progression_request WHERE id=${id}::uuid AND status IN ('pending','question') AND ${decision==='approve'}::boolean
    AND (kind='unlock' OR (
     COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${r.user_id}::uuid AND kind='bonus' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${p.bonus_calls}<=${p.bonus_daily_cap}
     AND COALESCE((SELECT sum(calls) FROM progression_grant WHERE user_id=${r.user_id}::uuid AND kind='bonus' AND created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${p.bonus_calls}<=${p.bonus_monthly_cap}))
   ON CONFLICT(user_id,grant_key) DO NOTHING`,
  sql`UPDATE progression_request SET status=${status},decision_history=decision_history||jsonb_build_array(jsonb_build_object('status',${status}::text,'at',now(),'actor',${adminId}::text)),decision_note=${note.trim()},decided_by=${adminId}::uuid,decided_at=now()
   WHERE id=${id}::uuid AND status IN ('pending','question') AND (${decision!=='approve'}::boolean OR
    EXISTS(SELECT 1 FROM progression_grant WHERE user_id=${r.user_id}::uuid AND grant_key='review:'||${id})) RETURNING status`,
  sql`SELECT status FROM progression_request WHERE id=${id}::uuid`,
 ]);
 const final=(results[3]?.[0] as {status?:string}|undefined)?.status;
 if(decision==='approve'&&final!=='approved'&&final!=='denied')throw new Error('bonus_cap_reached');
 return {status:final??r.status};
}

/** Guided prerequisites never affect support, basic editing or early practice. */
export async function checkProgressionTool(userId:string,workflow:string):Promise<Response|null>{
 const step=workflow==='resume-full'?'tailor':['quick-apply','apply-email'].includes(workflow)?'apply':null;
 if(!step)return null;
 const account=await progressionAccount(userId);if(account.existing)return null;
 const grant=await getOneAsUser(userId,"SELECT id FROM progression_grant WHERE user_id=$1 AND kind='unlock' AND step_id=$2 AND (expires_at IS NULL OR expires_at>now())",[userId,step]);if(grant)return null;
 const snapshot=await buildJourneySnapshot(userId);
 await syncMilestones(userId,snapshot.metrics);
 const earned=await getOneAsUser(userId,"SELECT id FROM progression_grant WHERE user_id=$1 AND (grant_key=$2 OR (kind='unlock' AND step_id=$3)) LIMIT 1",[userId,step==='apply'?'first-tailored':'earned:tailor',step]);
 if(earned)return null;
 const ready=step==='tailor'?snapshot.metrics.savedJobs>0&&snapshot.metrics.forgeComplete:snapshot.metrics.resumeTailored;
 return ready?null:Response.json({code:'progression_locked',stepId:step,error:STEP_COPY[step].reason+' Ask t.ROY in the progress bar to open it early.'},{status:403});
}

export async function exportProgression(userId:string){const [account,grants,requests]=await Promise.all([
 queryAsUser(userId,'SELECT existing_access,created_at FROM progression_account WHERE user_id=$1',[userId]),
 queryAsUser(userId,'SELECT kind,step_id,calls,label,expires_at,created_at FROM progression_grant WHERE user_id=$1 ORDER BY created_at',[userId]),
 queryAsUser<RequestRow>(userId,'SELECT * FROM progression_request WHERE user_id=$1 ORDER BY created_at',[userId]),
]);return {account,grants,requests:requests.map(r=>requestView(r,true))};}
