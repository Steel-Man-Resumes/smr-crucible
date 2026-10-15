import {it} from "node:test";
import assert from "node:assert/strict";
import {runOrgVerificationCall, verificationUsage} from "../org-verification-call";
const response=(content:string,usage:unknown={prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}})=>new Response(JSON.stringify({usage,choices:[{message:{content}}]}),{status:200});
it("OpenAI totals split cached input without guessing missing counts",()=>{
 assert.deepEqual(verificationUsage({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40}}),{inputTokens:60,outputTokens:20,cacheReadInputTokens:40});
 assert(Number.isNaN(verificationUsage({}).inputTokens));
 assert(Number.isNaN(verificationUsage({prompt_tokens:10,completion_tokens:2,prompt_tokens_details:{cached_tokens:40}}).inputTokens));
});
it("reported usage is awaited before malformed answer is rejected, with no duplicate",async()=>{
 const events:unknown[]=[];
 const result=await runOrgVerificationCall("model","prompt","synthetic",{fetch:async()=>response("not-json"),record:async(u,m)=>{await Promise.resolve();events.push({u,m})}});
 assert.equal(result,null); assert.equal(events.length,1); assert.deepEqual(events[0],{u:{inputTokens:60,outputTokens:20,cacheReadInputTokens:40},m:{outcome:"succeeded",usageMissing:false}});
});
it("transport, provider error, and invalid provider JSON record one failed unpriced call",async()=>{
 for(const fetch of [async()=>{throw Error("transport")},async()=>new Response("bad-json",{status:502}),async()=>new Response(JSON.stringify({error:"private body"}),{status:429})]) {
  const events:{u:unknown,m:unknown}[]=[];
  assert.equal(await runOrgVerificationCall("model","prompt","synthetic",{fetch,record:async(u,m)=>{events.push({u,m})}}),null);
  assert.equal(events.length,1); assert.deepEqual(events[0].m,{outcome:"failed",usageMissing:true}); assert(!JSON.stringify(events).includes("private body"));
 }
});
it("valid verification returns only unsupported claims and records available usage",async()=>{
 let count=0;
 const result=await runOrgVerificationCall("model","prompt","synthetic",{fetch:async()=>response(JSON.stringify({sentences:[{text:"invented",kind:"claim",supported:false},{text:"true",kind:"claim",supported:true}]})),record:async()=>{count++}});
 assert.deepEqual(result,["invented"]); assert.equal(count,1);
});
