import { NextResponse } from 'next/server';
import { revisionCaller } from '@/lib/revision-route';
import { loadJobPackage } from '@/lib/job-package-load';
import { jobPackageFiles } from '@/lib/job-package-files';
import { isUuid, incrementUserUsage } from '@crucible/core';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
  const caller=await revisionCaller();
  if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status,headers});
  const params=new URL(request.url).searchParams;
  const applicationId=params.get('applicationId'),revisionId=params.get('revisionId');
  if(!isUuid(applicationId)||!isUuid(revisionId))return NextResponse.json({error:'Choose a saved package.'},{status:400,headers});
  try{
    const packet=await loadJobPackage(caller.userId,applicationId,revisionId);
    if(!packet)return NextResponse.json({error:'Save the current application package again.'},{status:404,headers});
    if(await incrementUserUsage(caller.userId,'job-package-preview')>100)return NextResponse.json({error:'Preview allowance used for today.'},{status:429,headers});
    const format=params.get('format')==='docx'?'docx':'pdf';
    const kind=params.get('kind')==='cover_letter'?'cover_letter':'resume';
    const [pdf]=await jobPackageFiles(packet,{kind,format});
    if(!pdf)return NextResponse.json({error:'This package has no cover letter.'},{status:404,headers});
    return new Response(new Uint8Array(Buffer.from(pdf.content,'base64')),{headers:{...headers,'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`${format==='pdf'?'inline':'attachment'}; filename="${pdf.filename}"`}});
  }catch{return NextResponse.json({error:'The saved preview could not be prepared.'},{status:503,headers});}
}
