/** Provider adapters retain original structured evidence. Search choices never widen on retry. */
import { defaultJobSearchFilters, distanceMiles, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import type { JSearchJob } from "./job-search-types";
export interface ProviderResult { jobs: JSearchJob[]; failed: boolean; status?: number; requests?: number; partial?: boolean }
export interface ProviderSearchOptions { filters?: JobSearchFilters; maxPages?: number }
const PAGES = 2, PAGE_SIZE = 25;
const finite=(value:unknown):number|null=>value!==null && value!==undefined && value!=="" && Number.isFinite(Number(value)) ? Number(value) : null;
async function getJson(url:string,init:RequestInit,timeoutMs:number):Promise<{ok:boolean;status:number;json:any}>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try {const response=await fetch(url,{...init,signal:controller.signal,cache:"no-store"});return {ok:response.ok,status:response.status,json:response.ok?await response.json():null};}finally{clearTimeout(timer);}
}
const maxPages=(value?:number)=>Math.min(PAGES,Math.max(1,Number.isInteger(value)?value!:PAGES));
const strict=(mode:string,f:JobSearchFilters)=>mode==="must"&&!f.includeUnknown;
export const milesToProviderKm=(miles:number)=>Math.floor(miles*1.609344);

/** Official JSearch spec: radius uses km and is advisory, cursor comes from data.cursor. */
export function jsearchUrl(role:string,location:string,filters:JobSearchFilters,cursor?:string):URL {
  const url=new URL("https://jsearch.p.rapidapi.com/search-v2");
  url.searchParams.set("query",`${role||"jobs"} in ${location}`);
  url.searchParams.set("country","us"); url.searchParams.set("num_pages","1");
  if(cursor)url.searchParams.set("cursor",cursor);
  if(filters.radiusMiles.value!==null&&filters.radiusMiles.mode==="must")url.searchParams.set("radius",String(milesToProviderKm(filters.radiusMiles.value)));
  const days=filters.postedWithinDays.value;
  const posted=days===1?"today":days===3?"3days":days===7?"week":days===30?"month":"all";
  url.searchParams.set("date_posted",strict(filters.postedWithinDays.mode,filters)?posted:"all");
  if(strict(filters.arrangements.mode,filters)&&filters.arrangements.value.length===1&&filters.arrangements.value[0]==="remote")url.searchParams.set("work_from_home","true");
  const types:Record<string,string>={full_time:"FULLTIME",part_time:"PARTTIME",contract:"CONTRACTOR",internship:"INTERN"};
  if(strict(filters.employmentTypes.mode,filters)&&filters.employmentTypes.value.length&&filters.employmentTypes.value.every(x=>types[x]))url.searchParams.set("employment_types",filters.employmentTypes.value.map(x=>types[x]).join(","));
  return url;
}
export async function fetchJSearchJobs(role:string,location:string,_radiusMiles:number,options:ProviderSearchOptions={}):Promise<ProviderResult>{
  const key=process.env.JSEARCH_API_KEY;if(!key)return{jobs:[],failed:true,requests:0};
  const filters=options.filters||{...defaultJobSearchFilters(),radiusMiles:{value:_radiusMiles,mode:"must" as const}};
  const started=Date.now(),jobs:JSearchJob[]=[];let requests=0,cursor:string|undefined,partial=false,failed=false,status:number|undefined;
  const seen=new Set<string>();
  for(let page=0;page<maxPages(options.maxPages);page++){
    let response:{ok:boolean;status:number;json:any}|null=null;
    // One retry has the identical query, units, radius and hard filters.
    for(let attempt=0;attempt<(page===0?2:1)&&requests<3;attempt++){
      const remaining=24000-(Date.now()-started);if(remaining<300){partial=true;break;}
      requests++;
      try{response=await getJson(jsearchUrl(role,location,filters,cursor).toString(),{headers:{"X-RapidAPI-Key":key,"X-RapidAPI-Host":"jsearch.p.rapidapi.com"}},remaining);}catch{response=null;}
      if(response?.ok||response?.status===429)break;
    }
    if(!response?.ok){failed=jobs.length===0;status=response?.status;partial=jobs.length>0;break;}
    const payload=response.json?.data;const values=Array.isArray(payload)?payload:Array.isArray(payload?.jobs)?payload.jobs:[];
    jobs.push(...values.filter((j:any)=>j&&typeof j.job_id==="string").map((j:JSearchJob)=>({...j,source:"jsearch",fetched_at:new Date().toISOString(),source_fields:{salary_min:j.job_min_salary,salary_max:j.job_max_salary,salary_currency:j.job_salary_currency,salary_period:j.job_salary_period,employment_type:j.job_employment_type,employment_types:j.job_employment_types,remote:j.job_is_remote,latitude:j.job_latitude,longitude:j.job_longitude,posted_at:j.job_posted_at_datetime_utc,apply_options:j.apply_options}})));
    const next=typeof payload?.cursor==="string"?payload.cursor:undefined;
    if(!next||seen.has(next))break;seen.add(next);cursor=next;if(page===maxPages(options.maxPages)-1)partial=true;
  }
  return{jobs,failed,status,requests,partial};
}
export function adzunaUrl(role:string,location:string,radiusMiles:number,filters:JobSearchFilters,page=1):URL{
  const url=new URL(`https://api.adzuna.com/v1/api/jobs/us/search/${page}`);
  url.searchParams.set("what",role||"jobs");url.searchParams.set("where",location);url.searchParams.set("results_per_page",String(PAGE_SIZE));url.searchParams.set("content-type","application/json");
  if(filters.radiusMiles.value!==null&&filters.radiusMiles.mode==="must")url.searchParams.set("distance",String(milesToProviderKm(radiusMiles)));
  if(filters.postedWithinDays.value!==null&&strict(filters.postedWithinDays.mode,filters))url.searchParams.set("max_days_old",String(filters.postedWithinDays.value));
  if(strict(filters.employmentTypes.mode,filters)&&filters.employmentTypes.value.length===1){const key=({full_time:"full_time",part_time:"part_time",contract:"contract"} as Record<string,string>)[filters.employmentTypes.value[0]];if(key)url.searchParams.set(key,"1");}
  // The public spec does not identify the source salary period. Never assume
  // annual pay here or convert an hourly requirement into a guessed year.
  return url;
}
export function mapAdzunaJob(r:any,index=0):JSearchJob{
  const area=Array.isArray(r.location?.area)?r.location.area:[];
  return{job_id:`adzuna-${r.id??index}`,job_title:r.title||"Job",employer_name:r.company?.display_name||"Employer",employer_logo:null,job_city:area.length>2?area.at(-1):(typeof r.location?.display_name==="string"?r.location.display_name.split(",")[0].trim()||null:null),job_state:area[1]||null,job_country:"US",job_description:r.description||"",
    job_min_salary:finite(r.salary_min),job_max_salary:finite(r.salary_max),job_salary_currency:r.salary_currency||null,job_salary_period:r.salary_period||null,salary_is_predicted:r.salary_is_predicted===1||r.salary_is_predicted==="1",
    job_employment_type:r.contract_time==="part_time"?"Part-time":r.contract_time==="full_time"?"Full-time":r.contract_type==="contract"?"Contract":null,
    job_posted_at_datetime_utc:r.created||"",job_is_remote:null,employer_website:null,job_apply_link:r.redirect_url||null,job_latitude:finite(r.latitude),job_longitude:finite(r.longitude),source:"adzuna",fetched_at:new Date().toISOString(),
    source_fields:{salary_min:r.salary_min,salary_max:r.salary_max,salary_is_predicted:r.salary_is_predicted,salary_currency:r.salary_currency,salary_period:r.salary_period,contract_time:r.contract_time,contract_type:r.contract_type,created:r.created,latitude:r.latitude,longitude:r.longitude,location:r.location,redirect_url:r.redirect_url}};
}
export async function fetchAdzunaJobs(role:string,location:string,radiusMiles:number,timeoutMs:number,options:ProviderSearchOptions={}):Promise<ProviderResult>{
  const id=process.env.ADZUNA_APP_ID,key=process.env.ADZUNA_APP_KEY;if(!id||!key)return{jobs:[],failed:true,requests:0};
  const f=options.filters||{...defaultJobSearchFilters(),radiusMiles:{value:radiusMiles,mode:"must" as const}};const jobs:JSearchJob[]=[];let requests=0,partial=false;
  for(let page=1;page<=maxPages(options.maxPages);page++){
    const url=adzunaUrl(role,location,radiusMiles,f,page);url.searchParams.set("app_id",id);url.searchParams.set("app_key",key);requests++;
    try{const r=await getJson(url.toString(),{},timeoutMs);if(!r.ok)return{jobs,failed:jobs.length===0,status:r.status,requests,partial:jobs.length>0};const values=Array.isArray(r.json?.results)?r.json.results:[];jobs.push(...values.map(mapAdzunaJob));if(values.length<PAGE_SIZE)break;if(page===maxPages(options.maxPages))partial=true;}catch{return{jobs,failed:jobs.length===0,requests,partial:jobs.length>0};}
  }return{jobs,failed:false,requests,partial};
}
/** Official USAJOBS API: city/ZIP LocationName plus Radius; never substitute a tenant state. */
export function usaJobsUrl(role:string,location:string,filters:JobSearchFilters,page=1):URL{
  const url=new URL("https://data.usajobs.gov/api/search");if(role)url.searchParams.set("Keyword",role);url.searchParams.set("LocationName",location);url.searchParams.set("ResultsPerPage",String(PAGE_SIZE));url.searchParams.set("Page",String(page));url.searchParams.set("Fields","Full");
  if(filters.radiusMiles.value!==null&&filters.radiusMiles.mode==="must")url.searchParams.set("Radius",String(filters.radiusMiles.value));
  if(filters.postedWithinDays.value!==null&&filters.postedWithinDays.value<=60&&strict(filters.postedWithinDays.mode,filters))url.searchParams.set("DatePosted",String(filters.postedWithinDays.value));
  if(strict(filters.arrangements.mode,filters)&&filters.arrangements.value.length===1&&filters.arrangements.value[0]==="remote")url.searchParams.set("RemoteIndicator","True");
  if(strict(filters.employmentTypes.mode,filters)&&filters.employmentTypes.value.length&&filters.employmentTypes.value.every(x=>x==="full_time"||x==="part_time"))url.searchParams.set("PositionScheduleTypeCode",filters.employmentTypes.value.map(x=>x==="full_time"?"1":"2").join(";"));
  if(filters.pay.minimum!==null&&filters.pay.period==="year"&&filters.pay.currency==="USD"&&strict(filters.pay.mode,filters))url.searchParams.set("RemunerationMinimumAmount",String(filters.pay.minimum));
  return url;
}
export function mapUsaJobsJob(item:any,index=0,location="",filters=defaultJobSearchFilters()):JSearchJob|null{
  const d=item?.MatchedObjectDescriptor;if(!d)return null;const locations=Array.isArray(d.PositionLocation)?d.PositionLocation:[];
  const needle=location.split(",")[0].trim().toLowerCase();let place=locations.find((l:any)=>String(l.CityName||l.LocationName||"").toLowerCase().includes(needle))||locations[0]||{};
  if(filters.origin){const withCoords=locations.filter((l:any)=>finite(l.Latitude)!==null&&finite(l.Longitude)!==null);withCoords.sort((a:any,b:any)=>distanceMiles(filters.origin!,{latitude:Number(a.Latitude),longitude:Number(a.Longitude)})-distanceMiles(filters.origin!,{latitude:Number(b.Latitude),longitude:Number(b.Longitude)}));if(withCoords.length)place=withCoords[0];}
  const parts=String(place.LocationName||"").split(",").map((s:string)=>s.trim());const pay=d.PositionRemuneration?.[0];const details=d.UserArea?.Details||{};
  return{job_id:`usajobs-${item.MatchedObjectId||d.PositionID||index}`,job_title:d.PositionTitle||"Job",employer_name:d.OrganizationName||"Federal agency",employer_logo:null,
    job_city:String(place.CityName||parts[0]||"").split(",")[0].trim()||null,job_state:place.CountrySubDivisionName||place.CountrySubDivisionCode||parts[1]||null,job_country:place.CountryCode||"US",job_description:[details.JobSummary,d.QualificationSummary,details.Requirements,details.MajorDuties].filter(Boolean).join("\n"),
    job_min_salary:finite(pay?.MinimumRange),job_max_salary:finite(pay?.MaximumRange),job_salary_currency:"USD",job_salary_period:pay?.RateIntervalCode||pay?.Description?.replace(/^Per /i,"")||null,
    job_employment_type:d.PositionSchedule?.[0]?.Name||null,job_posted_at_datetime_utc:d.PublicationStartDate||"",job_is_remote:typeof details.RemoteIndicator==="boolean"?details.RemoteIndicator:null,
    job_latitude:finite(place.Latitude),job_longitude:finite(place.Longitude),employer_website:null,job_apply_link:d.ApplyURI?.[0]||d.PositionURI||null,job_apply_is_direct:true,employer_kind:"direct",source:"usajobs",fetched_at:new Date().toISOString(),
    source_fields:{PositionRemuneration:d.PositionRemuneration,PositionSchedule:d.PositionSchedule,PositionOfferingType:d.PositionOfferingType,PositionLocation:d.PositionLocation,PublicationStartDate:d.PublicationStartDate,RemoteIndicator:details.RemoteIndicator,ApplyURI:d.ApplyURI}};
}
export async function fetchUsaJobs(role:string,location:string,timeoutMs:number,options:ProviderSearchOptions={}):Promise<ProviderResult>{
  const key=process.env.USAJOBS_API_KEY,ua=process.env.USAJOBS_USER_AGENT;if(!key||!ua||!location)return{jobs:[],failed:true,requests:0};
  const filters=options.filters||defaultJobSearchFilters(),jobs:JSearchJob[]=[];let requests=0,partial=false;
  for(let page=1;page<=maxPages(options.maxPages);page++){requests++;
    try{const r=await getJson(usaJobsUrl(role,location,filters,page).toString(),{headers:{Host:"data.usajobs.gov","User-Agent":ua,"Authorization-Key":key}},timeoutMs);if(!r.ok)return{jobs,failed:jobs.length===0,status:r.status,requests,partial:jobs.length>0};const values=Array.isArray(r.json?.SearchResult?.SearchResultItems)?r.json.SearchResult.SearchResultItems:[];jobs.push(...values.map((v:any,i:number)=>mapUsaJobsJob(v,i,location,filters)).filter(Boolean));if(values.length<PAGE_SIZE)break;if(page===maxPages(options.maxPages))partial=true;}catch{return{jobs,failed:jobs.length===0,requests,partial:jobs.length>0};}
  }return{jobs,failed:false,requests,partial};
}
import { normalizeLocation, placeKey } from "./job-location";
const CORP=/\b(?:inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|plc|lp|llp|usa|us|the)\b/g;
const norm=(s:unknown)=>String(s??"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
export function employerKey(name:unknown):string{return norm(name).replace(CORP," ").replace(/\s+/g," ").trim();}
/** Title without the place it is posted in, so "Technician - Germantown, WI" and "Technician - Menomonee Falls" are one posting. */
export function titleKey(j:Pick<JSearchJob,"job_title"|"job_city"|"job_state">):string{
  let t=` ${norm(j.job_title)} `;
  for(const part of [j.job_city,j.job_state])for(const seg of String(part||"").split(",")){const n=norm(seg);if(n.length>1)t=t.split(` ${n} `).join(" ");}
  const state=placeKey(String(j.job_state||""));if(state.startsWith("state:")){const full=state.slice(6);t=t.split(` ${full} `).join(" ");}
  return t.replace(/\s+/g," ").trim();
}
export const jobPlace=(j:JSearchJob)=>normalizeLocation(j.job_city,j.job_state);
/** Place identity from parsed fields, never display text: "Milwaukee, WI" and "Milwaukee, Wisconsin" are one place. */
export function placeId(city:unknown,state:unknown):string{
  const c=norm(String(city||"").split(",")[0]);
  const fromCity=String(city||"").split(",").slice(1).map(x=>x.trim()).find(Boolean);
  const st=placeKey(String(state||fromCity||""));
  return `${c}|${st}`;
}
const PLACEHOLDER_EMPLOYER=new Set(["","employer","confidential","confidential employer","federal agency","company","unknown","hiring","hiring company","not disclosed","private","anonymous"]);
export const isPlaceholderEmployer=(name:unknown)=>PLACEHOLDER_EMPLOYER.has(employerKey(name));
const linkOf=(j:JSearchJob)=>j.job_apply_link||j.job_google_link||null;
/** Parse "City, ST" from the search box into a place id; state may be absent. */
function wantedPlace(searchLocation?:string):{city:string;state:string|null}{
  const [city,state]=String(searchLocation||"").split(",").map(x=>x.trim());
  return {city:norm(city),state:state?placeKey(state):null};
}
/**
 * One card per posting, built in two steps.
 * Same opening: two listings are one opening when they share employer and
 * title (place words removed) and either sit in different places (a posting
 * listed once per town), come from different providers (JSearch and Adzuna
 * copies), or carry the same apply link. Two listings from one provider in one
 * place with different apply links are different openings and stay separate.
 * A repeated provider id is always the same posting. Placeholder employers
 * ("Employer", "Confidential") never merge.
 * The card shown is the copy in the searched city and state (city alone when
 * the search gave no state). Every other copy is kept in job_listings with its
 * own place and apply link, and provenance stays in source_variants.
 */
export function mergeJobs(lists:JSearchJob[][],searchLocation?:string):JSearchJob[]{
  type Card={members:JSearchJob[]};
  const cards:Card[]=[],byKey=new Map<string,Card[]>(),byId=new Map<string,Card>();
  for(const list of lists)for(const job of list){
    const id=`${job.source||""}:${job.job_id}`;
    const known=byId.get(id);if(known){known.members.push(job);continue;}
    let card:Card|undefined;
    if(!isPlaceholderEmployer(job.employer_name)){
      const k=`${employerKey(job.employer_name)}|${titleKey(job)}`;
      const here=placeId(job.job_city,job.job_state),link=linkOf(job);
      const candidates=byKey.get(k)||[];
      card=candidates.find(c=>!c.members.some(m=>(m.source||"")===(job.source||"")&&placeId(m.job_city,m.job_state)===here&&linkOf(m)!==link));
      if(!card){card={members:[]};candidates.push(card);byKey.set(k,candidates);cards.push(card);}
    }else{card={members:[]};cards.push(card);}
    card.members.push(job);byId.set(id,card);
  }
  const wanted=wantedPlace(searchLocation);
  return cards.map(({members})=>{
    const exact=wanted.city?members.find(j=>{const [c,st]=placeId(j.job_city,j.job_state).split("|");return c===wanted.city&&(!wanted.state||st===wanted.state);}):undefined;
    const pick=exact||members[0];
    const merged:JSearchJob={...pick};
    const pickPlace=placeId(pick.job_city,pick.job_state);
    const listings:NonNullable<JSearchJob["job_listings"]>=[];
    for(const j of members){
      if(j===pick)continue;
      merged.source_variants=[...(merged.source_variants||[]),{source:j.source||"unknown",id:j.job_id,fields:j.source_fields||{}}];
      listings.push({place:jobPlace(j),placeId:placeId(j.job_city,j.job_state),city:j.job_city||null,state:j.job_state||null,title:j.job_title,apply_url:linkOf(j),source:j.source||"unknown",id:j.job_id});
      if(j.job_apply_is_direct===true&&merged.job_apply_is_direct!==true&&placeId(j.job_city,j.job_state)===pickPlace){merged.job_apply_link=j.job_apply_link;merged.job_apply_is_direct=true;}
    }
    if(listings.length)merged.job_listings=listings;
    return merged;
  });
}
