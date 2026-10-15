/** One live, versioned publication contract for pages and assistant tools. */
import { query } from './db';
import { resourceAppSql, type ResourceAppRow, type ResourcePlaceQuery } from './resourceDirectoryShared';
import { clampEmployerPage, employerLikePattern, publicCaveat } from './employer';
export const DIRECTORY_CONTRACT_VERSION = '2026-10-15.v1' as const;
export type PublicationResult<T> = {status:'ok';contractVersion:typeof DIRECTORY_CONTRACT_VERSION;asOf:string;data:T} | {status:'unavailable';contractVersion:typeof DIRECTORY_CONTRACT_VERSION;asOf:string;data:T;error:string};
export interface PublishedEmployer {
 id:string;name:string;industry:string|null;state:string;city:string|null;location:string|null;
 applyUrl:string|null;roleTypes:string|null;evidence:string|null;caveats:string|null;checkedAt:string;
 expiresAt:string;sourceUrl:string;relationshipTier:'T1'|'T2'|'T3'|null;scope:string;standing:string;version:string;
}
export interface PublishedResource extends ResourceAppRow {
 fees:string|null;what_to_bring:string|null;limits:string|null;expires_on:string;
 verification_tier:'R1'|'R2'|'R3'|'R4';version:string;
}
export interface PublishedResourceStep {
 chain_key:string;state:string;goal:string;unlocks:string[];verified_on:string;expires_on:string;n:number;
 action:string;agency:string|null;requires:string[];cost:string|null;wait_time:string|null;where_how:string|null;
 url:string|null;phone:string|null;no_docs_fallback:string|null;fee_waiver:string|null;source_url:string;step_verified_on:string;version:string;
}
export function isPublicationId(id:unknown):id is string {return typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);}
export function isChainKey(key:unknown):key is string {return typeof key==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(key);}
export async function publicationRead<T>(empty:T,read:()=>Promise<T>):Promise<PublicationResult<T>> {
 const meta={contractVersion:DIRECTORY_CONTRACT_VERSION,asOf:new Date().toISOString()};
 try{return {...meta,status:'ok',data:await read()};}catch{return {...meta,status:'unavailable',data:empty,error:'The checked directory could not be read. Try again.'};}
}
const EMPLOYER_FIELDS=`id,name,industry,state,city,location,apply_url AS "applyUrl",role_types AS "roleTypes",
 evidence,caveats,checked_at::text AS "checkedAt",expires_at::text AS "expiresAt",source_url AS "sourceUrl",
 relationship_tier AS "relationshipTier",scope,standing,version`;
export function publishedEmployerSql(opts:{q?:string;state?:string;industry?:string;page?:number}) {
 const params:unknown[]=[];const where=["expires_at > (now() AT TIME ZONE 'UTC')::date"];
 const q=employerLikePattern(opts.q);
 if(q){params.push(q);where.push(`concat_ws(' ',name,industry,city,state,role_types) ILIKE $${params.length} ESCAPE '\\'`);}
 if(opts.state && /^[A-Z]{2}$/.test(opts.state)){params.push(opts.state);where.push(`state=$${params.length}`);}
 if(opts.industry){params.push(opts.industry.slice(0,80));where.push(`industry=$${params.length}`);}
 params.push(clampEmployerPage(opts.page)*25);
 return {sql:`SELECT ${EMPLOYER_FIELDS} FROM employer_publication_v WHERE ${where.join(' AND ')} ORDER BY state,name,id LIMIT 25 OFFSET $${params.length}`,params};
}
export function searchVerifiedEmployers(opts:{q?:string;state?:string;industry?:string;page?:number}={}) {
 return publicationRead<PublishedEmployer[]>([],async()=>{const {sql,params}=publishedEmployerSql(opts);const rows=await query<PublishedEmployer>(sql,params);return rows.map(r=>({...r,caveats:publicCaveat(r.caveats)}));});
}
export function getVerifiedEmployer(id:string) {
 return publicationRead<PublishedEmployer|null>(null,async()=>{if(!isPublicationId(id))return null;
 const rows=await query<PublishedEmployer>(`SELECT ${EMPLOYER_FIELDS} FROM employer_publication_v WHERE id=$1::uuid`,[id]);
 return rows[0]?{...rows[0],caveats:publicCaveat(rows[0].caveats)}:null;});
}
export function resolvePublishedEmployerAlias(source:string,externalId:string){
 return publicationRead<string|null>(null,async()=>{if(!['website','airtable','employer_intel'].includes(source)||!externalId||externalId.length>160)return null;
 const rows=await query<{id:string|null}>('SELECT public.resolve_employer_publication_alias($1,$2) AS id',[source,externalId]);return rows[0]?.id??null;});
}
const RESOURCE_FIELDS=`service_id,org_name,service_name,description,eligibility,area_id,area_label,geo_scope,
 state,county,counties,city,address,zip,phone,hours,website,source_url,last_checked::text AS last_checked,
 fees,what_to_bring,limits,expires_on::text AS expires_on,verification_tier,version`;
export function searchVerifiedResources(opts:ResourcePlaceQuery) {
 return publicationRead<PublishedResource[]>([],async()=>{
 const {sql,params}=resourceAppSql(opts);if(!(params[0] as string[]).length)return [];
 // Existing tested place/scope and per-level bounds; join only the selected IDs.
 const selected=sql.replaceAll('resource_app_v','resource_publication_v');
 return query<PublishedResource>(`WITH selected AS (${selected}) SELECT ${RESOURCE_FIELDS.split(',').map(f=>'p.'+f.trim()).join(',')} FROM resource_publication_v p JOIN selected s USING(service_id) ORDER BY p.last_checked DESC,p.org_name,p.service_id`,params);
 });
}
export function getVerifiedResource(id:string) {
 return publicationRead<PublishedResource|null>(null,async()=>{if(!isPublicationId(id))return null;const rows=await query<PublishedResource>(`SELECT ${RESOURCE_FIELDS} FROM resource_publication_v WHERE service_id=$1::uuid`,[id]);return rows[0]??null;});
}
export function getApprovedResourceChain(chainKey:string) {
 return publicationRead<PublishedResourceStep[]>([],async()=>{if(!isChainKey(chainKey))return [];
 const rows=await query<PublishedResourceStep>(`SELECT chain_key,state,goal,unlocks,verified_on::text,expires_on::text,n,action,agency,requires,cost,wait_time,where_how,url,phone,no_docs_fallback,fee_waiver,source_url,step_verified_on::text,version FROM resource_chain_publication_v WHERE chain_key=$1 ORDER BY n LIMIT 51`,[chainKey]);
 // A chain must never appear incomplete.
 if(rows.length>50)throw new Error('Chain exceeds supported size');return rows;});
}
export interface PublishedResourceChainSummary {chainKey:string;goal:string;state:string;checkedAt:string;expiresAt:string;stepCount:number}
export function searchApprovedResourceChains(opts:{state?:string;q?:string}={}) {
 return publicationRead<PublishedResourceChainSummary[]>([],async()=>{
 const params:unknown[]=[];const where:string[]=[];
 if(opts.state&&/^[A-Z]{2}$/.test(opts.state)){params.push(opts.state);where.push(`state=$${params.length}`);}
 const pattern=employerLikePattern(opts.q);if(pattern){params.push(pattern);where.push(`goal ILIKE $${params.length} ESCAPE '\\'`);}
 return query<PublishedResourceChainSummary>(`SELECT chain_key AS "chainKey",goal,state,min(verified_on)::text AS "checkedAt",min(expires_on)::text AS "expiresAt",count(*)::int AS "stepCount" FROM resource_chain_publication_v ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY chain_key,goal,state HAVING count(*)<=50 ORDER BY state,goal,chain_key LIMIT 25`,params);
 });
}
