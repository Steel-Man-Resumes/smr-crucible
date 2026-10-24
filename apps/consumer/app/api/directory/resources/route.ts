import {searchVerifiedResources,publicationBands,RESOURCE_AREAS} from '@crucible/core';
import {directoryReadLimit,directoryResponse,directoryStatePaging} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** bands: "A" (default, the checked publication), "AB" or "ABC" to add the listed and found layers, best first.
 * scope=state with a state: every row in the state plus national ones (a state page), not only the place match.
 * Each band and reach level is capped at 50 rows. The trusted website (service key) can add page=0,1,2... (limit up to 200)
 * to read the whole state in pages in the same order; everyone else keeps the capped slice. */
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;
 return directoryResponse(await searchVerifiedResources({state:p.get('state')?.toUpperCase()??null,areas:p.get('areas')?.split(',').slice(0,20)??RESOURCE_AREAS,cityKey:p.get('cityKey'),countyKeys:p.get('countyKeys')?.split(',').slice(0,10),zip:p.get('zip'),bands:publicationBands(p.get('bands')),wholeState:p.get('scope')==='state',paging:directoryStatePaging(request,p)}));
}
