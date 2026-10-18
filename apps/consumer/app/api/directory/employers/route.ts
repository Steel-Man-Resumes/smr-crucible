import {searchVerifiedEmployers,parseEmployerBands} from '@crucible/core';
import {directoryReadLimit,directoryResponse} from '@/lib/directory-response';
export const dynamic='force-dynamic';
/** bands: "A" (default, the mark) or "AB" to add the reported layer (public evidence below the mark; never marks a listing). */
export async function GET(request:Request){
 const denied=await directoryReadLimit(request);if(denied)return denied;
 const p=new URL(request.url).searchParams;
 return directoryResponse(await searchVerifiedEmployers({q:p.get('q')??undefined,state:p.get('state')?.toUpperCase(),industry:p.get('industry')??undefined,page:Number(p.get('page')??0),limit:Number(p.get('limit')??25),bands:parseEmployerBands(p.get('bands'))}));
}
