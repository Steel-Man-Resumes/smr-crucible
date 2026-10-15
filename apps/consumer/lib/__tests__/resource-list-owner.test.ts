import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {forgeSessionUser} from '../session-policy';
function fixture(detail:boolean, real:unknown, effective:unknown){
 const calls:string[]=[];const exports:any={};
 const source=readFileSync(new URL(detail?'../../app/api/resource-lists/[id]/route.ts':'../../app/api/resource-lists/route.ts',import.meta.url),'utf8');
 const core={ResourceListSelection:{safeParse:()=>({success:true,data:{serviceIds:['resource']}})},isPublicationId:()=>true,incrementUserUsage:async(id:string)=>{calls.push(`usage:${id}`);return 1;},saveResourceList:async(id:string)=>{calls.push(`save:${id}`);return {id:'saved'};},reopenResourceList:async(id:string)=>{calls.push(`read:${id}`);return {status:'ok'};}};
 const modules:any={'next/server':{NextResponse:{json:(data:unknown,init:any={})=>({status:init.status??200,data})}},'@/auth':{auth:async()=>real},'@/lib/effective-auth':{effectiveAuth:async()=>effective},'@/lib/session-policy':{forgeSessionUser},'@/lib/same-origin':{isSameOriginJsonPost:()=>true},'@/lib/premium-server':{checkPremium:async()=>null},'@crucible/core':core};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{if(!(name in modules))throw Error(name);return modules[name];}});
 return {calls,run:()=>detail?exports.GET({}, {params:Promise.resolve({id:'saved'})}):exports.POST({headers:new Headers(),json:async()=>({serviceIds:['resource']})})};
}
for(const detail of [false,true])test(`${detail?'reopen':'save'} only uses the completed real owner's session`,async()=>{
 const owner={user:{id:'owner'}};
 for(const [real,effective,status] of [[null,owner,401],[{user:{id:'owner',mfa:false}},owner,401],[owner,{user:{id:'other'}},403],[owner,null,403]] as const){
  const f=fixture(detail,real,effective);assert.equal((await f.run()).status,status);assert.deepEqual(f.calls,[]);
 }
 const f=fixture(detail,owner,owner);assert.equal((await f.run()).status,200);assert.ok(f.calls.includes(`${detail?'read':'save'}:owner`));
});
