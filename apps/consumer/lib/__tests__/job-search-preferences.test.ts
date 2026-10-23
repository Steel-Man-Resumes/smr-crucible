import { test } from "node:test";
import assert from "node:assert/strict";
import { loadJobSearchPreferences, resolveSearchLane, type JobSearchPreferenceStore } from "../job-search-preferences";
import { defaultJobSearchFilters, readJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
const USER="sample-owner",A="00000000-0000-4000-8000-0000000000a1",B="00000000-0000-4000-8000-0000000000b1";
const filtersA=readJobSearchFilters({radiusMiles:{value:10},pay:{minimum:24}}),filtersB=readJobSearchFilters({radiusMiles:{value:50},pay:{minimum:60,period:"year"}});
const store:JobSearchPreferenceStore={
 focus:async uid=>uid===USER?{laneId:A}:null,
 lane:async(uid,id)=>uid===USER&&[A,B].includes(id)?{target_role:id===A?"Electrical apprentice":"Research role"}:null,
 preferences:async uid=>uid===USER?{jobSearchDefaults:{filters:defaultJobSearchFilters(),role:"Account role",location:"Sample City, CO",revision:3},jobSearchLanes:{[A]:{filters:filtersA,role:"Electrical apprentice",location:"Sample City, CO",revision:2},[B]:{filters:filtersB,role:"Research role",location:"Other City, CO",revision:7}}}:null,
};
test("reload reads only the validated lane's choices, and account defaults remain distinct",async()=>{
 const first=await loadJobSearchPreferences(USER,A,store),second=await loadJobSearchPreferences(USER,B,store);
 assert.equal(first.saved.filters.radiusMiles.value,10);assert.equal(second.saved.filters.radiusMiles.value,50);
 assert.equal(first.revision,2);assert.equal(second.revision,7);assert.equal(first.accountRevision,3);
 assert.equal(first.target,"Electrical apprentice");assert.equal(second.target,"Research role");
 const main=await loadJobSearchPreferences(USER,"main",store);assert.equal(main.saved.role,"Account role");assert.equal(main.inherited,true);assert.equal(main.revision,0);
 assert.equal((await loadJobSearchPreferences(USER,undefined,store)).laneId,A);
});
test("a foreign or missing lane fails before its defaults or preferences can be used",async()=>{
 await assert.rejects(()=>loadJobSearchPreferences("other-owner",A,store),/unavailable/);
 await assert.rejects(()=>resolveSearchLane(USER,"not-a-lane",store),/Invalid/);
 assert.equal(await resolveSearchLane(USER,"main",store),null);
});

test("built-in starting settings are distinguishable from saved account and lane choices", async () => {
 assert.equal((await loadJobSearchPreferences(USER,A,store)).source,"lane");
 assert.equal((await loadJobSearchPreferences(USER,"main",store)).source,"account");
 const fresh=await loadJobSearchPreferences(USER,"main",{...store,preferences:async()=>null});
 assert.equal(fresh.source,"built-in");assert.equal(fresh.saved.filters.radiusMiles.value,25);
});
