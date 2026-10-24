import {searchVerifiedResources,publicationBands,RESOURCE_AREAS} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** bands: "A" (default, the checked publication), "AB" or "ABC" to add the listed and found layers, best first.
 * scope=state with a state: every row in the state plus national ones (a state page), not only the place match.
 * Add page=1.. (and limit, max 200) with scope=state to walk the whole list; without page the read keeps the per-level cap. */
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;
 return directoryResponse(await searchVerifiedResources({state:p.get('state')?.toUpperCase()??null,areas:p.get('areas')?.split(',').slice(0,20)??RESOURCE_AREAS,cityKey:p.get('cityKey'),countyKeys:p.get('countyKeys')?.split(',').slice(0,10),zip:p.get('zip'),bands:publicationBands(p.get('bands')),wholeState:p.get('scope')==='state',page:p.has('page')?Number(p.get('page')):null,pageSize:p.has('limit')?Number(p.get('limit')):null}));
}
