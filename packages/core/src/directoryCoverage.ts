import {queryAsUser} from './db';
import {isResourceArea} from './resourceDirectoryShared';
export interface CoverageRequest {state:string;place:string;category:string;reason:'new_area'|'low_coverage'|'stale_listing'|'missing_prerequisite'}
export async function requestDirectoryCoverage(userId:string,input:CoverageRequest) {
 if(!/^[A-Z]{2}$/.test(input.state)||typeof input.place!=='string'||!input.place.trim()||input.place.length>80||!['new_area','low_coverage','stale_listing','missing_prerequisite'].includes(input.reason)||!(input.category==='employers'||isResourceArea(input.category)))throw new Error('Invalid coverage request');
 const rows=await queryAsUser<{id:string}>(userId,'SELECT public.request_directory_coverage($1,$2,$3,$4) AS id',[input.state,input.place,input.category,input.reason]);
 if(!rows[0]?.id)throw new Error('Coverage request unavailable');
 return {requestId:rows[0].id,status:'pending' as const};
}
/** Owner RLS remains the authority; app callers never receive the proposal payload. */
export async function listDirectoryCoverage(userId:string) {
 return queryAsUser<{id:string;state:string;place:string;category:string;gap:string;priority:string;status:string;created_at:string}>(userId,
 `SELECT id,payload->>'state' AS state,payload->>'place' AS place,payload->>'category' AS category,
 payload->>'gap' AS gap,payload->>'priority' AS priority,status,created_at::text
 FROM directory_proposal WHERE kind='geo_ticket' AND payload->>'coverage_key' IS NOT NULL
 ORDER BY (status='pending') DESC,created_at DESC LIMIT 100`);
}
/** Only an owner with admin RLS can review; this never activates publication. */
export async function reviewDirectoryCoverage(userId:string,id:string,status:'approved'|'rejected') {
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['approved','rejected'].includes(status))throw new Error('Invalid review');
 const rows=await queryAsUser<{id:string}>(userId,`UPDATE directory_proposal SET status=$3,decided_by=$1,decided_at=now()
 WHERE id=$2::uuid AND kind='geo_ticket' AND payload->>'coverage_key' IS NOT NULL AND status='pending' RETURNING id`,[userId,id,status]);
 return rows.length>0;
}
