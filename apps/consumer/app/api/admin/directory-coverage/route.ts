import {NextResponse} from 'next/server';
import {requirePlatformAdmin} from '@/lib/org-guard';
import {listDirectoryCoverage} from '@crucible/core';
export const dynamic='force-dynamic';
export async function GET(){const guard=await requirePlatformAdmin();if(!guard.ok)return guard.response;
 try{return NextResponse.json({data:await listDirectoryCoverage(guard.userId)},{headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({error:'Coverage requests could not be read.'},{status:503});}}
export async function POST(request:Request){
 const {isSameOriginJsonPost}=await import('@/lib/same-origin');if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:'Not allowed'},{status:403});
 const guard=await requirePlatformAdmin();if(!guard.ok)return guard.response;
 const body=await request.json().catch(()=>null);
 if(!body||!['approved','rejected'].includes(body.status))return NextResponse.json({error:'Invalid review'},{status:400});
 try{const {reviewDirectoryCoverage}=await import('@crucible/core');const updated=await reviewDirectoryCoverage(guard.userId,body.id,body.status);return NextResponse.json({updated},{status:updated?200:404});}
 catch{return NextResponse.json({error:'Review could not be saved.'},{status:503});}
}
