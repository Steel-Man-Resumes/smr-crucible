/** Search preferences stay in the owner's existing profile JSON, keyed by validated lane. */
import { getOneAsUser, getLaneFocus, getOpenLane, isUuid, queryAsUser } from "@crucible/core";
import { defaultJobSearchFilters, readJobSearchFilters, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
export interface SavedJobSearch { role: string; location: string; filters: JobSearchFilters; revision: number }
export interface JobSearchPreferenceStore {
  focus(userId:string):Promise<{laneId:string|null}|null>;
  lane(userId:string,laneId:string):Promise<{target_role:string|null}|null>;
  preferences(userId:string):Promise<unknown>;
}
const liveStore:JobSearchPreferenceStore={focus:getLaneFocus,lane:getOpenLane,preferences:async userId=>(await getOneAsUser<{preferences:unknown}>(userId,"SELECT preferences FROM consumer_profile WHERE user_id=$1",[userId]))?.preferences};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function readSavedJobSearch(value:unknown):SavedJobSearch|null {
  const v=object(value);if(!v.filters)return null;
  return{role:typeof v.role==="string"?v.role.slice(0,200):"",location:typeof v.location==="string"?v.location.slice(0,200):"",filters:readJobSearchFilters(v.filters),revision:typeof v.revision==="number"?v.revision:0};
}
export async function resolveSearchLane(userId:string,requested?:unknown,store:JobSearchPreferenceStore=liveStore):Promise<string|null>{
  let id:string|null;
  if(requested===undefined){id=(await store.focus(userId))?.laneId||null;}
  else if(requested===null||requested==="main")id=null;
  else if(isUuid(requested))id=requested;
  else throw new Error("Invalid search lane.");
  if(id&&!(await store.lane(userId,id)))throw new Error("Search lane is unavailable.");
  return id;
}
export async function loadJobSearchPreferences(userId:string,requested?:unknown,store:JobSearchPreferenceStore=liveStore){
  const laneId=await resolveSearchLane(userId,requested,store);
  const preferences=object(await store.preferences(userId)),lanes=object(preferences.jobSearchLanes);
  const account=readSavedJobSearch(preferences.jobSearchDefaults);
  const lane=readSavedJobSearch(lanes[laneId||"main"]);
  const target=laneId?(await store.lane(userId,laneId))?.target_role||null:null;
  return{laneId,target,saved:lane||account||{role:"",location:"",filters:defaultJobSearchFilters(),revision:0},revision:lane?.revision||0,accountRevision:account?.revision||0,inherited:!lane&&!!account};
}
export async function saveJobSearchPreferences(userId:string,input:{laneId?:unknown;scope?:unknown;revision?:unknown;role?:unknown;location?:unknown;filters?:unknown}){
  const laneId=await resolveSearchLane(userId,input.laneId);
  const scope=input.scope==="account"?"account":"lane";
  if(!Number.isInteger(input.revision)||Number(input.revision)<0)throw new Error("Reload search preferences before saving.");
  const filters=readJobSearchFilters(input.filters);
  // Device coordinates are one-search context. Remembering ordinary filters
  // does not retain a person's precise position.
  filters.origin=null;
  const saved:SavedJobSearch={role:typeof input.role==="string"?input.role.trim().slice(0,200):"",location:typeof input.location==="string"?input.location.trim().slice(0,200):"",filters,revision:Number(input.revision)+1};
  const key=scope==="account"?"jobSearchDefaults":"jobSearchLanes";
  const laneKey=laneId||"main";
  const rows=await queryAsUser<{preferences:unknown}>(userId,
    `INSERT INTO consumer_profile (user_id,preferences)
     SELECT $1,CASE WHEN $3='jobSearchDefaults' THEN jsonb_build_object($3::text,$2::jsonb) ELSE jsonb_build_object($3::text,jsonb_build_object($4::text,$2::jsonb)) END WHERE $5::int=0 OR EXISTS (SELECT 1 FROM consumer_profile WHERE user_id=$1)
     ON CONFLICT (user_id) DO UPDATE SET preferences=COALESCE(consumer_profile.preferences,'{}'::jsonb) ||
       CASE WHEN $3='jobSearchDefaults' THEN jsonb_build_object($3::text,$2::jsonb)
       ELSE jsonb_build_object($3::text,COALESCE(consumer_profile.preferences->$3::text,'{}'::jsonb) || jsonb_build_object($4::text,$2::jsonb)) END,updated_at=now()
     WHERE COALESCE(CASE WHEN $3='jobSearchDefaults' THEN (consumer_profile.preferences->$3::text->>'revision')::int ELSE (consumer_profile.preferences->$3::text->$4::text->>'revision')::int END,0)=$5::int
     RETURNING preferences`,[userId,JSON.stringify(saved),key,laneKey,Number(input.revision)]);
  return rows.length?{laneId,saved,scope}:null;
}
