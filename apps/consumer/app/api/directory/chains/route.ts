import {searchApprovedResourceChains} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;
 return directoryResponse(await searchApprovedResourceChains({state:p.get('state')?.toUpperCase(),q:p.get('q')??undefined}));
}
