import {getVerifiedResource} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 return directoryResponse(await getVerifiedResource((await context.params).id),true);
}
