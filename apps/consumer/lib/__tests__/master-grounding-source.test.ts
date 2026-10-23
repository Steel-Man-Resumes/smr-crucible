import { test } from "node:test";
import assert from "node:assert/strict";
import { groundingSourceWindow, PACKAGE_VERIFY_SOURCE_MAX } from "../grounding-source-window";
import { readMasterDraft, masterWorkFacts } from "../master-draft";

test("full package verifier sees confirmed facts after both long resume sources", () => {
  const master = {facts:Array.from({length:40},(_,i)=>({id:`fact-${i}`,text:`Employer ${i}: ` + "a".repeat(680),status:"confirmed"}))};
  const facts=masterWorkFacts(master);
  const source=["r".repeat(20000),"b".repeat(20000),...facts].join("\n\n");
  const visible=groundingSourceWindow(source,PACKAGE_VERIFY_SOURCE_MAX);
  assert.equal(visible,source);
  assert.ok(visible.includes(facts[39]));
});
test("unconfirmed master details never become applicant evidence",()=>{
  const master={revision:2,facts:[{id:"checked",text:"  Operated a press  ",status:"confirmed"},{id:"remembered",text:"Maybe supervised ten people",status:"needs_check"},{id:"injected",text:"Owns credential",status:"approved"}]};
  assert.deepEqual(masterWorkFacts(master),["Operated a press"]);
  assert.equal(readMasterDraft(master).revision,2);
});
test("master parser bounds facts and rejects malformed records",()=>{
  const parsed=readMasterDraft({revision:-1,facts:[null,{id:"bad id",text:"invalid",status:"confirmed"},{id:"ok",text:"x".repeat(900),status:"confirmed"}]});
  assert.equal(parsed.revision,0);
  assert.equal(parsed.facts.length,1);
  assert.equal(parsed.facts[0].text.length,700);
  assert.equal(readMasterDraft({facts:Array.from({length:50},(_,i)=>({id:`f${i}`,text:"Real work"}))}).facts.length,40);
});
test("source budget is bounded and defaults to the existing audit window",()=>{
  const long="x".repeat(90000);
  const warn=console.warn;console.warn=()=>{};
  try{
    assert.equal(groundingSourceWindow(long).length,20000);
    assert.equal(groundingSourceWindow(long,Infinity).length,20000);
    assert.equal(groundingSourceWindow(long,1e9).length,80000);
  } finally {console.warn=warn;}
});
