import {NextResponse} from 'next/server';
import {effectiveAuth} from '@/lib/effective-auth';
import {forgeSessionUser} from '@/lib/session-policy';
import {reopenResourceList,isPublicationId} from '@crucible/core';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const userId=forgeSessionUser(await effectiveAuth())?.id;
 if(!userId)return NextResponse.json({error:'Sign in to see your choices.'},{status:401});
 const {id}=await context.params;if(!isPublicationId(id))return NextResponse.json({error:'Not found'},{status:404});
 try{const result=await reopenResourceList(userId,id);return NextResponse.json(result??{error:'Not found'},{status:!result?404:result.status==='unavailable'?503:200,headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({error:'Saved choices could not be read.'},{status:503});}
}
