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

test("confirmedAt is server-owned: kept, stamped on first confirm, never taken from the browser", async () => {
  const { stampConfirmedAt } = await import("../master-draft");
  const now = new Date("2026-10-23T12:00:00Z");
  const prior = readMasterDraft({ revision: 3, facts: [
    { id: "old", text: "Ran forklift", status: "confirmed" },
    { id: "kept", text: "Led crew", status: "confirmed", confirmedAt: "2026-10-01T00:00:00.000Z" },
    { id: "later", text: "Trained two", status: "needs_check" },
  ] });
  const next = readMasterDraft({ revision: 3, facts: [
    { id: "old", text: "Ran forklift", status: "confirmed", confirmedAt: "2020-01-01T00:00:00Z" },
    { id: "kept", text: "Led crew", status: "confirmed" },
    { id: "later", text: "Trained two", status: "confirmed", confirmedAt: "1999-01-01T00:00:00Z" },
    { id: "new", text: "Counted stock", status: "needs_check", confirmedAt: "2026-10-02T00:00:00Z" },
  ] });
  const out = stampConfirmedAt(next, prior, now).facts;
  assert.equal(out[0].confirmedAt, undefined);
  assert.equal(out[1].confirmedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(out[2].confirmedAt, now.toISOString());
  assert.equal(out[3].confirmedAt, undefined);
});
