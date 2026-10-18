import {getApprovedResourceChain} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{key:string}>}){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const bands=(new URL(request.url).searchParams.get('bands')||'A').toUpperCase().includes('B')?['A','B'] as const:['A'] as const;
 return directoryResponse(await getApprovedResourceChain((await context.params).key,bands));
}
