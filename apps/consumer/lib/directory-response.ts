import {NextResponse} from 'next/server';
import {type PublicationResult} from '@crucible/core';
import {getClientIp,checkAuthRateLimit} from './auth-rate-limit';
/** Shared public retrieval ceiling, never a corpus/export route. */
export async function directoryReadLimit(request:Request) {
 try {
  const limit=await checkAuthRateLimit('directory-public:'+getClientIp(request),{maxRequests:120,windowMs:60_000});
  if(!limit.allowed)return NextResponse.json({error:'Please wait a moment and try again.'},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(Math.max(1,Math.ceil(limit.resetIn/1000)))}});
  return null;
 }catch{return NextResponse.json({error:'Directory temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export function directoryResponse<T>(result:PublicationResult<T>,detail=false) {
 return NextResponse.json(result,{status:result.status==='unavailable'?503:detail&&result.data===null?404:200,headers:{'Cache-Control':'no-store'}});
}
