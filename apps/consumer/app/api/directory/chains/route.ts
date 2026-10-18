import {searchApprovedResourceChains} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** bands: "A" (default, approved by a person) or "AB" to add chains found on official pages but not yet approved. */
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;const bands=(p.get('bands')||'A').toUpperCase().includes('B')?['A','B'] as const:['A'] as const;
 return directoryResponse(await searchApprovedResourceChains({state:p.get('state')?.toUpperCase(),q:p.get('q')??undefined,bands}));
}
