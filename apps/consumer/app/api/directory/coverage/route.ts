import {NextResponse} from 'next/server';
import {effectiveAuth} from '@/lib/effective-auth';
import {forgeSessionUser} from '@/lib/session-policy';
import {isSameOriginJsonPost} from '@/lib/same-origin';
import {requestDirectoryCoverage,incrementUserUsage} from '@crucible/core';
export async function POST(request:Request){
 if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:'Not allowed'},{status:403});
 const userId=forgeSessionUser(await effectiveAuth())?.id;
 if(!userId)return NextResponse.json({error:'Sign in to request coverage.'},{status:401});
 try{
  const body=await request.json();
  if(await incrementUserUsage(userId,'directory-coverage')>20)return NextResponse.json({error:'Please try again tomorrow.'},{status:429});
  return NextResponse.json(await requestDirectoryCoverage(userId,body));
 }catch{return NextResponse.json({error:'Coverage request could not be recorded. Check the place and try again.'},{status:400});}
}
