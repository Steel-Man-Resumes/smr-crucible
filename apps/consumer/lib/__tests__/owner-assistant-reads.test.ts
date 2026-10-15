import { it } from "node:test";
import assert from "node:assert/strict";
import {createOwnerReads, ownerCostSummary} from "../owner-assistant-reads";
import {readFileSync} from "node:fs";
it("owner reads recheck identity and MFA, fail closed before data", async () => {
 let allowed = true, checked = 0, read = 0;
 const reads = createOwnerReads("owner", {
  authorize: async () => { checked++; return {ok: allowed, userId: "owner"}; },
  costs: async () => { read++; return {}; }, coverage: async () => {read++; return []},
 });
 assert.equal((await reads.costs({})).status, "ok"); allowed = false;
 assert.equal((await reads.coverage()).status, "unavailable"); assert.equal(checked, 2); assert.equal(read, 1);
 const wrong = createOwnerReads("owner", {authorize: async () => ({ok:true,userId:"different"}), costs: async () => {throw Error("must not read")}, coverage:async()=>{throw Error("must not read")}});
 assert.equal((await wrong.costs({})).status,"unavailable");
});
it("aggregate projection excludes per-person and extra service fields, preserving uncertainty", () => {
 const out = ownerCostSummary({days:30, totals:{calls:12,cost_usd:"0.400000",unpriced_calls:2,email:"private@example.test"}, perUser:[{email:"secret@example.test"}], perOrg:[{name:"private org"}], perEndpoint:Array.from({length:35},()=>({endpoint:"assistant", unpriced_calls:1, email:"private"})), policies:[{secret:"no"}]});
 const text=JSON.stringify(out); assert(!text.includes("private")); assert(!text.includes("secret")); assert.equal(out.perEndpoint.length,30); assert.equal(out.totals.unpriced_calls,2); assert.equal(out.writesAvailable,false);
});
it("bounded cost windows and coverage outputs do not expose raw submissions", async () => {
 let daysSeen=0;
 const reads=createOwnerReads("owner",{authorize:async()=>({ok:true,userId:"owner"}),costs:async(_,days)=>{daysSeen=days;return{}},coverage:async()=>Array.from({length:40},()=>({id:"id",state:"MT",gap:"missing source",raw_payload:"private",status:"pending"}))});
 await reads.costs({days:999}); assert.equal(daysSeen,365);
 const out=await reads.coverage(); assert.equal(out.status,"ok"); assert(!JSON.stringify(out).includes("private")); assert.equal((out as {data:unknown[]}).data.length,25); assert.equal((out as {more:boolean}).more,true);
});
it("owner role is independent of membership and isolated from participant memory", () => {
 const source=readFileSync("app/api/assistant/route.ts","utf8");
 assert(source.includes('platformOwner ? buildOwnerTools(userId!)'));
 assert(source.includes('if (userId && !platformOwner)'));
 assert(source.includes('userId && !platformOwner && !staffActor && !isDisclosureRehearsal'));
 const tools=readFileSync("lib/tools/assistant-owner-tools.ts","utf8"); assert(tools.includes('requirePlatformAdmin()')); assert(!tools.includes('reviewDirectoryCoverage('));
});
