import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendJobPackage, buildJobPackageEmail, jobPackageVersion, type JobPackage, type JobPackageDeps } from '../job-package-email';
import type { PackageMail } from '../email-package-send';
const packet=():JobPackage=>({application:{id:'app-1',job_title:'Production lead',company:'Example Works',resume_artifact_id:'art-1'},revision:{id:'rev-1',user_id:'user-1',artifact_id:'art-1',revision_number:2,status:'draft',content_hash:'hash-1',resume_text:'Example Person\nWork history',letter_text:'Dear hiring team',open_items:['private note']} as JobPackage['revision']});
function setup(){
  const p=packet();const sent:PackageMail[]=[];const released:string[]=[];let claims=0;let files=0;let count=0;
  const deps:JobPackageDeps={load:async()=>p,target:async()=>({email:'self@example.test',proven:true,on:true}),claim:async()=>{claims++;return true;},release:async(_u,k)=>{released.push(k);},prepare:async(_u,_k,m)=>m,complete:async()=>{},count:async()=>{count++;return 1;},files:async()=>{files++;return [{filename:'resume.pdf',content:'test'}];},transport:async m=>{sent.push(m);return {ok:true,status:200};},from:'sender@example.test'};
  return {p,deps,sent,released,counts:()=>({claims,files,count})};
}
test('exact owned saved revision can be emailed as an honestly labelled draft',async()=>{
  const f=setup();const r=await sendJobPackage('user-1','app-1','rev-1',f.deps);
  assert.equal(r.status,'accepted');assert.equal(r.draft,true);assert.equal(r.revisionId,'rev-1');
  assert.equal(f.sent[0].to,'self@example.test');assert.match(f.sent[0].subject,/Job search delivery 1: Example Works - Production lead \(draft\)/);
  assert.doesNotMatch(f.sent[0].text,/private note/);assert.match(f.sent[0].text,/does not submit an application/);
});
test('foreign revision or different application artifact is refused before send or quota',async()=>{
  for(const mutate of [(p:JobPackage)=>{p.revision.user_id='other';},(p:JobPackage)=>{p.application.resume_artifact_id='other';},(p:JobPackage)=>{p.application.id='other';}]){
    const f=setup();mutate(f.p);assert.equal((await sendJobPackage('user-1','app-1','rev-1',f.deps)).status,'not_found');assert.equal(f.sent.length,0);assert.equal(f.counts().claims,0);
  }
});
test('unproven email and switched-off package email never reach render or provider',async()=>{
  for(const target of [{email:'self@example.test',proven:false,on:true},{email:'self@example.test',proven:true,on:false}]){
    const f=setup();f.deps.target=async()=>target;await sendJobPackage('user-1','app-1','rev-1',f.deps);assert.equal(f.sent.length,0);assert.equal(f.counts().files,0);
  }
});
test('duplicate, busy, uncertain and missing-table claims never render or send',async()=>{
  for(const claim of [false,'busy','uncertain',null] as const){const f=setup();f.deps.claim=async()=>claim;const r=await sendJobPackage('user-1','app-1','rev-1',f.deps);assert.equal(r.status,claim===false?'already':claim===null?'unavailable':'pending');assert.equal(f.sent.length,0);assert.equal(f.counts().count,0);}
});
test('recipient change after preparation prevents transport',async()=>{
  const f=setup();let n=0;f.deps.target=async()=>({email:++n===1?'self@example.test':'new@example.test',proven:true,on:true});
  assert.equal((await sendJobPackage('user-1','app-1','rev-1',f.deps)).status,'changed');assert.equal(f.sent.length,0);
});
test('daily recipient cap releases an unattempted claim',async()=>{
  const f=setup();f.deps.count=async()=>4;assert.equal((await sendJobPackage('user-1','app-1','rev-1',f.deps)).status,'limit');assert.equal(f.sent.length,0);assert.equal(f.released.length,1);
});
test('ambiguous transport failure retains claim and stable provider idempotency key',async()=>{
  const f=setup();f.deps.transport=async m=>{f.sent.push(m);throw new Error('network');};
  assert.equal((await sendJobPackage('user-1','app-1','rev-1',f.deps)).status,'pending');assert.equal(f.released.length,0);
  assert.equal(f.sent[0].idempotencyKey,`refinery-job-package-${jobPackageVersion('user-1',f.p)}`);
});
test('email escapes stored labels and omits private evidence',()=>{
  const p=packet();p.application.company='<script>example</script>\nnew line';
  const mail=buildJobPackageEmail(p);assert.doesNotMatch(mail.subject,/\n/);assert.doesNotMatch(mail.html,/<script>/);assert.doesNotMatch(mail.text,/private note/);
});
