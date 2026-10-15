import {NextResponse} from 'next/server';
import {incrementIpUsage,type PublicationResult} from '@crucible/core';
import {getClientIp} from './auth-rate-limit';
/** Shared public retrieval ceiling, never a corpus/export route. */
export async function directoryReadLimit(request:Request) {
 try {
  const n=await incrementIpUsage(getClientIp(request),'directory-public');
  if(n>100)return NextResponse.json({error:'Please try again tomorrow.'},{status:429,headers:{'Cache-Control':'no-store'}});
  return null;
 }catch{return NextResponse.json({error:'Directory temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export function directoryResponse<T>(result:PublicationResult<T>,detail=false) {
 return NextResponse.json(result,{status:result.status==='unavailable'?503:detail&&result.data===null?404:200,headers:{'Cache-Control':'no-store'}});
}
