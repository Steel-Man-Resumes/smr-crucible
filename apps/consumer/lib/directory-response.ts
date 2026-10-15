import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {type PublicationResult} from '@crucible/core';
import {getClientIp,checkAuthRateLimit} from './auth-rate-limit';
/** A trusted server (the public website, the public desk) presents the shared
 * key and reads under its own ceiling, or under the visitor's IP it forwards.
 * A missing or wrong key is an ordinary public caller: fail toward less. */
export const DIRECTORY_SERVICE_HEADER='x-smr-directory-key';
export const DIRECTORY_VISITOR_HEADER='x-smr-visitor-ip';
export const DIRECTORY_PUBLIC_PER_MINUTE=120;
export const DIRECTORY_SERVICE_PER_MINUTE=6000;
export function directoryCaller(request:Request,envKey=process.env.SMR_DIRECTORY_SERVICE_KEY):{kind:'public';ip:string}|{kind:'service';visitorIp:string|null} {
 const key=(envKey||'').trim();
 const given=(request.headers.get(DIRECTORY_SERVICE_HEADER)||'').trim();
 const a=Buffer.from(given),b=Buffer.from(key);
 if(key.length>=16&&a.length===b.length&&timingSafeEqual(a,b)){
  const forwarded=(request.headers.get(DIRECTORY_VISITOR_HEADER)||'').trim();
  return {kind:'service',visitorIp:/^[0-9a-fA-F.:]{3,45}$/.test(forwarded)?forwarded:null};
 }
 return {kind:'public',ip:getClientIp(request)};
}
export function directoryLimitKey(caller:ReturnType<typeof directoryCaller>) {
 if(caller.kind==='public')return {key:'directory-public:'+caller.ip,maxRequests:DIRECTORY_PUBLIC_PER_MINUTE};
 if(caller.visitorIp)return {key:'directory-public:'+caller.visitorIp,maxRequests:DIRECTORY_PUBLIC_PER_MINUTE};
 return {key:'directory-service',maxRequests:DIRECTORY_SERVICE_PER_MINUTE};
}
/** Shared public retrieval ceiling, never a corpus/export route. */
export async function directoryReadLimit(request:Request) {
 try {
  const {key,maxRequests}=directoryLimitKey(directoryCaller(request));
  const limit=await checkAuthRateLimit(key,{maxRequests,windowMs:60_000});
  if(!limit.allowed)return NextResponse.json({error:'Please wait a moment and try again.'},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(Math.max(1,Math.ceil(limit.resetIn/1000)))}});
  return null;
 }catch{return NextResponse.json({error:'Directory temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export function directoryResponse<T>(result:PublicationResult<T>,detail=false) {
 return NextResponse.json(result,{status:result.status==='unavailable'?503:detail&&result.data===null?404:200,headers:{'Cache-Control':'no-store'}});
}
