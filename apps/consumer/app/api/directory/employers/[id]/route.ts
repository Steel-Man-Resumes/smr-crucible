import {getVerifiedEmployer,parseEmployerBands} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** One employer by id, any band unless bands narrows it; the row says which band it is. */
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const raw=new URL(request.url).searchParams.get('bands');
 return directoryResponse(await getVerifiedEmployer((await context.params).id,raw?parseEmployerBands(raw):['A','B']),true);
}
