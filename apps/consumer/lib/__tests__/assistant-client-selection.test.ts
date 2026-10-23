import {it} from "node:test";
import assert from "node:assert/strict";
import {assistantClientSelection} from "../assistant-client-selection";
import {readWorkSelection} from "../assistant-work-context";
const remembered="11111111-1111-1111-1111-111111111111";
const explicit="22222222-2222-2222-2222-222222222222";
const selected="33333333-3333-3333-3333-333333333333";
it("legacy disclosure title links are not application selectors and remain server-parseable",()=>{
 const search=new URLSearchParams({job:"Warehouse Lead",company:"Example"});
 const result=assistantClientSelection(undefined,search,remembered);
 assert.deepEqual(result,{laneId:remembered}); assert.deepEqual(readWorkSelection(result),result);
});
it("explicit application and document selectors never inherit a different remembered lane",()=>{
 for(const [query,key] of [["job","applicationId"],["artifactId","artifactId"],["revisionId","revisionId"]] as const){
  const result=assistantClientSelection(undefined,new URLSearchParams({[query]:selected}),remembered);
  assert.deepEqual(result,{[key]:selected}); assert.equal(readWorkSelection(result).laneId,undefined);
 }
 for(const key of ["applicationId","artifactId","revisionId"] as const){
  assert.deepEqual(assistantClientSelection({[key]:selected},new URLSearchParams(),remembered),{[key]:selected});
 }
});
it("explicit URL or page lane remains authoritative as a selector, including Main",()=>{
 assert.deepEqual(assistantClientSelection({applicationId:selected,laneId:explicit},new URLSearchParams(),remembered),{applicationId:selected,laneId:explicit});
 assert.deepEqual(assistantClientSelection({applicationId:selected,laneId:explicit},new URLSearchParams({laneId:"main"}),remembered),{applicationId:selected,laneId:"main"});
 assert.deepEqual(assistantClientSelection({laneId:null},new URLSearchParams(),remembered),{laneId:null});
});
it("generic work preserves valid remembered lane and ignores corrupt browser state",()=>{
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams(),remembered),{laneId:remembered});
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams(),"main"),{laneId:"main"});
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams(),"all"),{});
});
it("client convenience does not weaken server validation for explicit document or lane ids",()=>{
 for(const key of ["artifactId","revisionId","laneId"]){
  assert.throws(()=>readWorkSelection(assistantClientSelection(undefined,new URLSearchParams({[key]:"invalid"}),remembered)),/invalid_selection/);
 }
 assert.throws(()=>readWorkSelection(assistantClientSelection({applicationId:"invalid"},new URLSearchParams(),remembered)),/invalid_selection/);
});

it("interview and editor links select actual saved work without stale lane", () => {
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams({applicationId:selected}),remembered,"/dashboard/interview"),{applicationId:selected});
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams({id:selected}),remembered,"/dashboard/application-tailor"),{artifactId:selected});
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams({id:selected}),remembered,"/dashboard/settings"),{});
 for (const kind of ["cv","creative","performer"]) assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams({lane:explicit}),remembered,`/dashboard/${kind}`),{laneId:explicit});
});

it("Refinery uses account focus instead of stale browser lane convenience", () => {
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams(),remembered,"/dashboard"),{});
 assert.deepEqual(assistantClientSelection(undefined,new URLSearchParams(),remembered,"/dashboard/vault"),{});
});
