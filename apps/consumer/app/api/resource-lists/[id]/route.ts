import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {effectiveAuth} from '@/lib/effective-auth';
import {forgeSessionUser} from '@/lib/session-policy';
import {reopenResourceList,isPublicationId} from '@crucible/core';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const userId=forgeSessionUser(await auth())?.id;
 if(!userId)return NextResponse.json({error:'Sign in to see your choices.'},{status:401});
 if(forgeSessionUser(await effectiveAuth())?.id!==userId)return NextResponse.json({error:'Return to your own account to use saved choices.'},{status:403});
 const {id}=await context.params;if(!isPublicationId(id))return NextResponse.json({error:'Not found'},{status:404});
 try{const result=await reopenResourceList(userId,id);return NextResponse.json(result??{error:'Not found'},{status:!result?404:result.status==='unavailable'?503:200,headers:{'Cache-Control':'private, no-store'}});}
 catch{return NextResponse.json({error:'Saved choices could not be read.'},{status:503});}
}
