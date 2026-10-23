import { test } from "node:test";
import assert from "node:assert/strict";
import { assessJobSearch, canonicalSearchFilters, defaultJobSearchFilters, readJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import { evidenceForJob, formatSourceSalary } from "../job-search-evidence";
import { adzunaUrl, fetchJSearchJobs, jsearchUrl, mapAdzunaJob, mapUsaJobsJob, mergeJobs, usaJobsUrl } from "../job-providers";
import type { JSearchJob } from "../job-search-types";
const NOW=Date.parse("2026-10-22T12:00:00Z");
const raw=(change:Partial<JSearchJob>={}):JSearchJob=>({job_id:"sample-1",job_title:"Electrical apprentice",employer_name:"Example Company",employer_logo:null,job_city:"Sample City",job_state:"Colorado",job_country:"US",job_description:"Day shift. No prior experience required.",job_min_salary:24,job_max_salary:29,job_salary_currency:"USD",job_salary_period:"HOUR",job_employment_type:"FULLTIME",job_posted_at_datetime_utc:"2026-10-21T12:00:00Z",job_is_remote:null,employer_website:null,job_latitude:39.74,job_longitude:-104.99,...change});
const job=(change:Partial<JSearchJob>={})=>{const source=raw(change);return {title:source.job_title,company:source.employer_name,full_description:source.job_description,evidence:evidenceForJob(source,"2026-10-22T12:00:00Z")};};

test("invalid radius fails instead of widening; nested choices round-trip and have stable distinct cache identities",()=>{
 const base=defaultJobSearchFilters();
 assert.throws(()=>readJobSearchFilters({radiusMiles:{value:501}}),/between/);
 assert.throws(()=>readJobSearchFilters({includeUnknown:"yes"}),/unknown/);
 const a=readJobSearchFilters({radiusMiles:{value:10},pay:{minimum:25},shifts:{value:["night","day"]}},base);
 const b=readJobSearchFilters({shifts:{value:["day","night"]},pay:{minimum:25},radiusMiles:{value:10}},base);
 assert.equal(canonicalSearchFilters(a),canonicalSearchFilters(b));
 assert.notEqual(canonicalSearchFilters(a),canonicalSearchFilters(readJobSearchFilters({pay:{minimum:26}},a)));
 assert.equal(readJobSearchFilters(JSON.parse(JSON.stringify(a))).radiusMiles.value,10);
 assert.equal(base.pay.minimum,null,"overrides never mutate saved defaults");
});
test("pay compares starting pay in the actual period and currency, never a guessed annual conversion",()=>{
 const f=readJobSearchFilters({radiusMiles:{value:null},pay:{minimum:25,period:"hour"},includeUnknown:false});
 assert.equal(assessJobSearch(job(),f,NOW).included,false,"a high upper range does not establish starting pay");
 assert.equal(assessJobSearch(job({job_min_salary:26}),f,NOW).included,true);
 const annual=assessJobSearch(job({job_salary_period:"YEAR",job_min_salary:80000}),f,NOW);
 assert.deepEqual(annual.requiredUnknown,["pay"]);assert.equal(annual.included,false);
 assert.equal(assessJobSearch(job({salary_is_predicted:true,job_min_salary:30}),f,NOW).included,false);
 const unknownAllowed=readJobSearchFilters({includeUnknown:true},f);
 assert.equal(assessJobSearch(job({job_salary_period:null}),unknownAllowed,NOW).included,true);
 assert.equal(assessJobSearch(job(),unknownAllowed,NOW).included,false,"known low pay is excluded even when unknowns are allowed");
 const formatted=formatSourceSalary(evidenceForJob(raw({job_min_salary:1200,job_max_salary:1500,job_salary_period:"WEEK"})).salary);
 assert.match(formatted!,/week/);assert.doesNotMatch(formatted!,/year|yr|k\+/);
});
test("distance is measured only from actual coordinates; missing geometry remains an explicit third state",()=>{
 const f=readJobSearchFilters({origin:{latitude:39.74,longitude:-104.99},radiusMiles:{value:10},includeUnknown:false});
 assert.equal(assessJobSearch(job(),f,NOW).included,true);
 assert.equal(assessJobSearch(job({job_latitude:40.74,job_longitude:-73.99}),f,NOW).included,false);
 const unknown=assessJobSearch(job(),readJobSearchFilters({origin:null},f),NOW);
 assert.equal(unknown.distanceMiles,null);assert.ok(unknown.requiredUnknown.includes("distance"));assert.equal(unknown.included,false);
 assert.equal(assessJobSearch(job(),readJobSearchFilters({origin:null,includeUnknown:true},f),NOW).included,true);
});
test("missing type/shift/remote and conflicting provider labels never become Full-time/day/on-site",()=>{
 const missing=evidenceForJob(raw({job_employment_type:null,job_is_remote:false,job_description:"No night shift required. Work experience preferred."}));
 assert.equal(missing.employmentTypes,null);assert.equal(missing.shifts,null);assert.equal(missing.arrangements,null);
 const contradictory=evidenceForJob(raw({job_employment_type:"Part-time",job_employment_types:["FULLTIME"]}));
 assert.equal(contradictory.employmentTypes,null);assert.match(contradictory.warnings.join(" "),/conflicting/);
 const unusual=evidenceForJob(raw({job_min_salary:1_000_000,job_max_salary:2_000_000}));
 assert.match(unusual.warnings.join(" "),/Verify/);assert.equal(unusual.salary.minimum,1_000_000,"an anomaly is preserved, not silently corrected");
});
test("preferences rank without excluding; explicit exclusions and unknown must-haves remain distinct",()=>{
 const f=readJobSearchFilters({radiusMiles:{value:null},shifts:{value:["night"],mode:"prefer"},includeUnknown:false});
 const assessed=assessJobSearch(job(),f,NOW);assert.equal(assessed.included,true);assert.deepEqual(assessed.preferred,["shift"]);
 const unknown=assessJobSearch(job({job_description:"Tasks supplied without schedule."}),f,NOW);assert.equal(unknown.included,true);assert.deepEqual(unknown.requiredUnknown,[]);
 assert.equal(assessJobSearch(job(),readJobSearchFilters({excludedEmployers:["Example Company"]},f),NOW).included,false);
 assert.equal(assessJobSearch(job(),readJobSearchFilters({excludedKeywords:["apprentice"]},f),NOW).included,false);
 const source=job({job_description:"CDL is not required. No experience required."});
 assert.equal(source.evidence.noExperienceRequired,true);
});
test("provider queries preserve radius and preference/unknown semantics using documented units",()=>{
 const f=readJobSearchFilters({radiusMiles:{value:25},employmentTypes:{value:["part_time"]},postedWithinDays:{value:7},includeUnknown:false});
 const j=jsearchUrl("welder","Sample City, CO",f);assert.equal(j.searchParams.get("radius"),"40");assert.equal(j.searchParams.get("employment_types"),"PARTTIME");assert.equal(j.searchParams.has("page"),false);
 const a=adzunaUrl("welder","Sample City, CO",25,f,2);assert.equal(a.searchParams.get("distance"),"40");assert.match(a.pathname,/\/2$/);assert.equal(a.searchParams.get("part_time"),"1");
 const u=usaJobsUrl("welder","Sample City, CO",f,2);assert.equal(u.searchParams.get("LocationName"),"Sample City, CO");assert.equal(u.searchParams.get("Radius"),"25");assert.equal(u.searchParams.get("Page"),"2");
 const preferred=readJobSearchFilters({employmentTypes:{mode:"prefer"},includeUnknown:true},f);
 assert.equal(jsearchUrl("welder","Sample City, CO",preferred).searchParams.has("employment_types"),false,"provider must not discard preferred/unknown candidates early");
});
test("JSearch retry and cursor pagination keep the same hard search within three request credits",async()=>{
 process.env.JSEARCH_API_KEY="synthetic-test-value";
 const original=globalThis.fetch;const urls:URL[]=[];
 globalThis.fetch=async input=>{urls.push(new URL(String(input)));const n=urls.length;return new Response(JSON.stringify(n===1?{error:"synthetic failure"}:{data:{jobs:[raw({job_id:`sample-${n}`})],cursor:n===2?"next-page":null}}),{status:n===1?503:200,headers:{"Content-Type":"application/json"}});};
 try{
  const result=await fetchJSearchJobs("welder","Sample City, CO",10,{filters:readJobSearchFilters({radiusMiles:{value:10}})});
  assert.equal(result.requests,3);assert.equal(result.jobs.length,2);assert.equal(urls[0].toString(),urls[1].toString());assert.equal(urls[2].searchParams.get("cursor"),"next-page");
  for(const url of urls)assert.equal(url.searchParams.get("radius"),"16");
 }finally{globalThis.fetch=original;delete process.env.JSEARCH_API_KEY;}
});
test("adapters preserve original periods, missing fields, coordinates and source variants",()=>{
 const a=mapAdzunaJob({id:"a",title:"Sample role",company:{display_name:"Example"},location:{area:["US","Colorado","Sample City"]},salary_min:123456,salary_max:135678,contract_time:null,latitude:39.74,longitude:-104.99});
 assert.equal(a.job_employment_type,null);assert.equal(a.job_salary_period,null);assert.equal(a.source_fields?.salary_min,123456);assert.equal(a.job_longitude,-104.99);
 const u=mapUsaJobsJob({MatchedObjectId:"f",MatchedObjectDescriptor:{PositionTitle:"Sample role",OrganizationName:"Example",PositionLocation:[{LocationName:"Far City, New York",Latitude:40.74,Longitude:-73.99},{LocationName:"Sample City, Colorado",Latitude:39.74,Longitude:-104.99}],PositionRemuneration:[{MinimumRange:"1200",MaximumRange:"1500",RateIntervalCode:"BW"}] }},0,"Sample City, CO");
 assert.equal(u?.job_salary_period,"BW");assert.equal(evidenceForJob(u!).salary.period,null,"unknown federal rate is not assumed hourly");assert.equal(u?.job_city,"Sample City");
 const merged=mergeJobs([[raw({job_title:"Sample role",employer_name:"Example",job_city:"Sample City",job_state:"Colorado",source:"jsearch"})],[{...a,job_apply_is_direct:true,job_apply_link:"https://example.com/apply"}]]);
 assert.equal(merged.length,1);assert.equal(merged[0].source_variants?.[0].source,"adzuna");assert.equal(merged[0].job_apply_link,"https://example.com/apply");
});
