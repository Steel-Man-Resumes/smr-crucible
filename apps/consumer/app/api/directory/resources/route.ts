import {searchVerifiedResources,RESOURCE_AREAS} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;
 return directoryResponse(await searchVerifiedResources({state:p.get('state')?.toUpperCase()??null,areas:p.get('areas')?.split(',').slice(0,20)??RESOURCE_AREAS,cityKey:p.get('cityKey'),countyKeys:p.get('countyKeys')?.split(',').slice(0,10),zip:p.get('zip')}));
}
