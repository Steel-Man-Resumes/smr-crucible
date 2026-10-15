import {getApprovedResourceChain} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{key:string}>}){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 return directoryResponse(await getApprovedResourceChain((await context.params).key));
}
