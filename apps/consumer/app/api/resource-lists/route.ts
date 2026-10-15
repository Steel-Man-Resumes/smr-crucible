import {NextResponse} from 'next/server';
import {effectiveAuth} from '@/lib/effective-auth';
import {forgeSessionUser} from '@/lib/session-policy';
import {isSameOriginJsonPost} from '@/lib/same-origin';
import {checkPremium} from '@/lib/premium-server';
import {saveResourceList,ResourceListSelection,incrementUserUsage} from '@crucible/core';
export async function POST(request:Request){
 if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:'Not allowed'},{status:403});
 const userId=forgeSessionUser(await effectiveAuth())?.id;
 if(!userId)return NextResponse.json({error:'Sign in to save your choices.'},{status:401});
 const denied=await checkPremium(userId,'resources');if(denied)return denied;
 const parsed=ResourceListSelection.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Choose up to 20 resources and 5 step lists.'},{status:400});
 try{
  if(await incrementUserUsage(userId,'resource-list-save')>100)return NextResponse.json({error:'Please try again tomorrow.'},{status:429});
  return NextResponse.json(await saveResourceList(userId,parsed.data),{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Your choices could not be saved. Refresh the checked listings and try again.'},{status:503});}
}
