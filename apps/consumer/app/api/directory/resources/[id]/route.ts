import {getVerifiedResource,publicationBands} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** A listing by id. A saved or shared link may point at any band; the row says which. bands narrows it ("A" for checked only). */
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const raw=new URL(request.url).searchParams.get('bands');
 return directoryResponse(await getVerifiedResource((await context.params).id,raw?publicationBands(raw):['A','B','C']),true);
}
