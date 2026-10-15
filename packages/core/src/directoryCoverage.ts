import {queryAsUser} from './db';
import {isResourceArea} from './resourceDirectoryShared';
export interface CoverageRequest {state:string;place:string;category:string;reason:'new_area'|'low_coverage'|'stale_listing'|'missing_prerequisite'}
export async function requestDirectoryCoverage(userId:string,input:CoverageRequest) {
 if(!/^[A-Z]{2}$/.test(input.state)||typeof input.place!=='string'||!input.place.trim()||input.place.length>80||!['new_area','low_coverage','stale_listing','missing_prerequisite'].includes(input.reason)||!(input.category==='employers'||isResourceArea(input.category)))throw new Error('Invalid coverage request');
 const rows=await queryAsUser<{id:string}>(userId,'SELECT public.request_directory_coverage($1,$2,$3,$4) AS id',[input.state,input.place,input.category,input.reason]);
 if(!rows[0]?.id)throw new Error('Coverage request unavailable');
 return {requestId:rows[0].id,status:'pending' as const};
}
