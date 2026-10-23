import { NextResponse } from 'next/server';
import { revisionCaller } from '@/lib/revision-route';
import { isSameOriginJsonPost } from '@/lib/same-origin';
import { loadJobPackage } from '@/lib/job-package-load';
import { sendJobPackage } from '@/lib/job-package-email';
import { jobPackageFiles } from '@/lib/job-package-files';
import { packageFrom, resendKey, resendTransport } from '@/lib/email-package-send';
import { isUuid, getPackageEmailTarget, incrementUserUsage, incrementIpUsage, claimPackageEmailVersion, releasePackageEmailVersion, preparePackageEmail, completePackageEmailVersion } from '@crucible/core';
export const runtime='nodejs';
export const maxDuration=60;
const NO_STORE={'Cache-Control':'no-store'};
export async function POST(request:Request){
  if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:'Not allowed'},{status:403,headers:NO_STORE});
  const caller=await revisionCaller();
  if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status,headers:NO_STORE});
  if(Number(request.headers.get('content-length')||0)>4000)return NextResponse.json({error:'Request too large'},{status:413,headers:NO_STORE});
  const text=await request.text();
  if(text.length>4000)return NextResponse.json({error:'Request too large'},{status:413,headers:NO_STORE});
  let body:unknown;try{body=JSON.parse(text);}catch{return NextResponse.json({error:'Invalid request'},{status:400,headers:NO_STORE});}
  const b=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
  if(!isUuid(b.applicationId)||!isUuid(b.revisionId))return NextResponse.json({error:'Choose a saved application and revision first.'},{status:400,headers:NO_STORE});
  try{
    // Separate email-attempt quota; no AI allowance is spent on self-delivery.
    if(await incrementUserUsage(caller.userId,'refinery-package-email')>10)return NextResponse.json({error:'Too many email attempts today. Download your saved package instead.'},{status:429,headers:NO_STORE});
    const key=resendKey();
    const result=await sendJobPackage(caller.userId,b.applicationId,b.revisionId,{
      load:loadJobPackage,target:getPackageEmailTarget,count:incrementIpUsage,
      claim:claimPackageEmailVersion,release:releasePackageEmailVersion,prepare:preparePackageEmail,complete:completePackageEmailVersion,
      files:jobPackageFiles,transport:key?resendTransport(key):null,from:packageFrom(),
    });
    const status=result.ok?200:result.status==='not_found'?404:result.status==='limit'?429:result.status==='unavailable'?503:result.status==='pending'?202:409;
    return NextResponse.json(result,{status,headers:NO_STORE});
  }catch{console.error('JOB_PACKAGE_EMAIL_FAILED');return NextResponse.json({error:'Email could not be prepared. Your saved work is still available.'},{status:503,headers:NO_STORE});}
}
