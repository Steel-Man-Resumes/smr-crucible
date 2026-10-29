/** One live, versioned publication contract for pages and assistant tools. */
import { query } from './db';
import { resourceBandSql, RESOURCE_BAND_FIELDS, parseBands, type ResourceAppRow, type ResourcePlaceQuery, type ResourceBand } from './resourceDirectoryShared';
import { clampEmployerPage, employerLikePattern, publicCaveat } from './employer';
/** 2026-10-18.v3: resources and chain steps carry band ('A' checked, 'B' listed, 'C' found) and band_reason
 * (migration 089); reads default to band A, so a v2 caller sees the same rows as before. v2 added
 * tier_confidence and corroboration_points (migration 088). */
/** 2026-10-18.v4: employers carry band ('A' the mark, 'B' reported) and band_reason (migration 090); reads default to A. */
export const DIRECTORY_CONTRACT_VERSION = '2026-10-18.v4' as const;
export type PublicationResult<T> = {status:'ok';contractVersion:typeof DIRECTORY_CONTRACT_VERSION;asOf:string;data:T} | {status:'unavailable';contractVersion:typeof DIRECTORY_CONTRACT_VERSION;asOf:string;data:T;error:string};
export interface PublishedEmployer {
 id:string;name:string;industry:string|null;state:string;city:string|null;location:string|null;
 applyUrl:string|null;roleTypes:string|null;evidence:string|null;caveats:string|null;checkedAt:string;
 expiresAt:string;sourceUrl:string;relationshipTier:'T1'|'T2'|'T3'|null;scope:string;standing:string;version:string;
 /** 'A' the mark (dated evidence that meets our rule); 'B' reported (public evidence below the mark). Never marks a listing. */
 band:'A'|'B';band_reason:string;
}
export interface PublishedResource extends ResourceAppRow {
 fees:string|null;what_to_bring:string|null;limits:string|null;expires_on:string;
 verification_tier:'R1'|'R2'|'R3'|'R4';
 /** 'low' = R2 reached only through a curated local guide; 'high' = an independent non-directory source agrees; null for other tiers. */
 tier_confidence:'low'|'high'|null;
 /** Distinct source hosts that count toward the tier (the listing's own page is not one). 0 below R2. */
 corroboration_points:number;version:string;
 /** 'A' checked (review passed), 'B' listed (dated source, no passed review yet), 'C' found (dataset-only, low confidence or lapsed). */
 band:ResourceBand;
 /** Plain words for the band, shown next to the listing. */
 band_reason:string;
}
export interface PublishedResourceStep {
 chain_key:string;state:string;goal:string;unlocks:string[];verified_on:string;expires_on:string;n:number;
 action:string;agency:string|null;requires:string[];cost:string|null;wait_time:string|null;where_how:string|null;
 url:string|null;phone:string|null;no_docs_fallback:string|null;fee_waiver:string|null;source_url:string;step_verified_on:string;version:string;
 /** 'A' approved by a person, every step fact-checked; 'B' steps found on official pages, not yet approved. */
 band:'A'|'B';band_reason:string;
}
export function isPublicationId(id:unknown):id is string {return typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);}
export function isChainKey(key:unknown):key is string {return typeof key==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(key);}
export async function publicationRead<T>(empty:T,read:()=>Promise<T>):Promise<PublicationResult<T>> {
 const meta={contractVersion:DIRECTORY_CONTRACT_VERSION,asOf:new Date().toISOString()};
 try{return {...meta,status:'ok',data:await read()};}catch{return {...meta,status:'unavailable',data:empty,error:'The checked directory could not be read. Try again.'};}
}
const EMPLOYER_FIELDS=`id,name,industry,state,city,location,apply_url AS "applyUrl",role_types AS "roleTypes",
 evidence,caveats,checked_at::text AS "checkedAt",expires_at::text AS "expiresAt",source_url AS "sourceUrl",
 relationship_tier AS "relationshipTier",scope,standing,version,band,band_reason`;
export type EmployerBand='A'|'B';
/** "A" (default, the mark) or "AB" to add the reported layer. */
export function parseEmployerBands(raw:unknown):EmployerBand[] {return typeof raw==='string'&&raw.toUpperCase().includes('B')?['A','B']:['A'];}
export const EMPLOYER_PAGE_MAX=200;
export function employerPageSize(limit:unknown):number {const n=Number(limit);return Number.isFinite(n)&&n>=1?Math.min(EMPLOYER_PAGE_MAX,Math.floor(n)):25;}
/** city: a preferred city, folded to letters only ("grandrapids"). It ranks that city's employers first BEFORE the limit; it never filters. */
export function publishedEmployerSql(opts:{q?:string;state?:string;industry?:string;page?:number;limit?:number;bands?:readonly EmployerBand[];city?:string|null}) {
 const params:unknown[]=[];const where=["expires_at > (now() AT TIME ZONE 'UTC')::date"];
 params.push([...(opts.bands??['A'])].filter(b=>b==='A'||b==='B'));where.push(`band=ANY($${params.length}::text[])`);
 const q=employerLikePattern(opts.q);
 if(q){params.push(q);where.push(`concat_ws(' ',name,industry,city,state,role_types) ILIKE $${params.length} ESCAPE '\\'`);}
 if(opts.state && /^[A-Z]{2}$/.test(opts.state)){params.push(opts.state);where.push(`state=$${params.length}`);}
 if(opts.industry){params.push(opts.industry.slice(0,80));where.push(`industry=$${params.length}`);}
 let order='band,state,name,id';
 const city=typeof opts.city==='string'?opts.city.toLowerCase().replace(/[^a-z]/g,'').slice(0,80):'';
 if(city){params.push(city);order=`CASE WHEN lower(regexp_replace(coalesce(city,''),'[^A-Za-z]','','g'))=$${params.length} THEN 0 ELSE 1 END,${order}`;}
 const size=employerPageSize(opts.limit);params.push(size);const limitAt=params.length;params.push(clampEmployerPage(opts.page)*size);
 return {sql:`SELECT ${EMPLOYER_FIELDS} FROM employer_band_publication_v WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${limitAt} OFFSET $${params.length}`,params};
}
export function searchVerifiedEmployers(opts:{q?:string;state?:string;industry?:string;page?:number;limit?:number;bands?:readonly EmployerBand[];city?:string|null}={}) {
 return publicationRead<PublishedEmployer[]>([],async()=>{const {sql,params}=publishedEmployerSql(opts);const rows=await query<PublishedEmployer>(sql,params);return rows.map(r=>({...r,caveats:publicCaveat(r.caveats)}));});
}
export function getVerifiedEmployer(id:string,bands:readonly EmployerBand[]=['A','B']) {
 return publicationRead<PublishedEmployer|null>(null,async()=>{if(!isPublicationId(id))return null;
 const rows=await query<PublishedEmployer>(`SELECT ${EMPLOYER_FIELDS} FROM employer_band_publication_v WHERE id=$1::uuid AND band=ANY($2::text[])`,[id,[...bands]]);
 return rows[0]?{...rows[0],caveats:publicCaveat(rows[0].caveats)}:null;});
}
export function resolvePublishedEmployerAlias(source:string,externalId:string){
 return publicationRead<string|null>(null,async()=>{if(!['website','airtable','employer_intel'].includes(source)||!externalId||externalId.length>160)return null;
 const rows=await query<{id:string|null}>('SELECT public.resolve_employer_publication_alias($1,$2) AS id',[source,externalId]);return rows[0]?.id??null;});
}
export const RESOURCE_FIELDS=RESOURCE_BAND_FIELDS;
/** Resources for a place. bands defaults to ['A'] (the checked publication); 'B' and 'C' add the listed and found layers, best first. */
export function searchVerifiedResources(opts:ResourcePlaceQuery&{bands?:readonly ResourceBand[];page?:number|null;pageSize?:number|null}) {
 return publicationRead<PublishedResource[]>([],async()=>{
 const {sql,params}=resourceBandSql(opts);if(!(params[0] as string[]).length)return [];
 return query<PublishedResource>(sql,params);
 });
}
/** Band list from a query string ("ABC", "A,B"); anything else means A only. */
export const publicationBands=parseBands;
export function getVerifiedResource(id:string,bands:readonly ResourceBand[]=['A','B','C']) {
 return publicationRead<PublishedResource|null>(null,async()=>{if(!isPublicationId(id))return null;const rows=await query<PublishedResource>(`SELECT ${RESOURCE_FIELDS} FROM resource_band_publication_v WHERE service_id=$1::uuid AND band=ANY($2::text[])`,[id,[...bands]]);return rows[0]??null;});
}
/** Aggregate standing of the resource map: services per state per band. No identities, no bulk export. */
export function getResourceCoverageSummary(){
 return publicationRead<{state:string;band:ResourceBand;services:number}[]>([],()=>query(`SELECT state,band,count(*)::int AS services FROM resource_band_publication_v GROUP BY state,band ORDER BY state,band LIMIT 200`));
}
const CHAIN_FIELDS='chain_key,state,goal,unlocks,verified_on::text,expires_on::text,n,action,agency,requires,cost,wait_time,where_how,url,phone,no_docs_fallback,fee_waiver,source_url,step_verified_on::text,version,band,band_reason';
/** One chain's steps. bands defaults to ['A'] (approved); 'B' adds chains found but not yet approved. */
export function getApprovedResourceChain(chainKey:string,bands:readonly ('A'|'B')[]=['A']) {
 return publicationRead<PublishedResourceStep[]>([],async()=>{if(!isChainKey(chainKey))return [];
 const rows=await query<PublishedResourceStep>(`SELECT ${CHAIN_FIELDS} FROM resource_chain_band_publication_v WHERE chain_key=$1 AND band=ANY($2::text[]) ORDER BY n LIMIT 51`,[chainKey,[...bands]]);
 // A chain must never appear incomplete.
 if(rows.length>50)throw new Error('Chain exceeds supported size');return rows;});
}
export interface PublishedResourceChainSummary {chainKey:string;goal:string;state:string;checkedAt:string;expiresAt:string;stepCount:number;band:'A'|'B'}
export function searchApprovedResourceChains(opts:{state?:string;q?:string;bands?:readonly ('A'|'B')[]}={}) {
 return publicationRead<PublishedResourceChainSummary[]>([],async()=>{
 const params:unknown[]=[];const where:string[]=[];
 params.push([...(opts.bands??['A'])].filter(b=>b==='A'||b==='B'));where.push(`band=ANY($${params.length}::text[])`);
 if(opts.state&&/^[A-Z]{2}$/.test(opts.state)){params.push(opts.state);where.push(`state=$${params.length}`);}
 const pattern=employerLikePattern(opts.q);if(pattern){params.push(pattern);where.push(`goal ILIKE $${params.length} ESCAPE '\\'`);}
 return query<PublishedResourceChainSummary>(`SELECT chain_key AS "chainKey",goal,state,min(verified_on)::text AS "checkedAt",min(expires_on)::text AS "expiresAt",count(*)::int AS "stepCount",band FROM resource_chain_band_publication_v ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY chain_key,goal,state,band HAVING count(*)<=50 ORDER BY band,state,goal,chain_key LIMIT 25`,params);
 });
}
/** Aggregate map standing only; no identities or bulk record export. */
export function getDirectoryCoverageSummary(){
 return publicationRead<{state:string;employers:number;topTier:number}[]>([],()=>query(`SELECT p.state,count(DISTINCT d.org_id)::int AS employers,coalesce(max(right(p.relationship_tier,1)::int),0)::int AS "topTier"
 FROM employer_publication_v p JOIN directory_public_v d ON d.place_id=p.id
 WHERE p.relationship_tier IS NOT NULL GROUP BY p.state ORDER BY p.state LIMIT 51`));
}
