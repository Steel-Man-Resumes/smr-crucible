import { effectiveAuth } from '@/lib/effective-auth';
import { getProgression } from '@/lib/progression-server';
import { readWorkSelection } from '@/lib/assistant-work-context';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const session=await effectiveAuth();if(!session?.user?.id)return Response.json({error:'Sign in to see your progress.'},{status:401});
 try {const params=new URL(request.url).searchParams;const raw:Record<string,string>={};for(const key of ['laneId','applicationId','artifactId','revisionId'])if(params.has(key))raw[key]=params.get(key)!;
 return Response.json({data:await getProgression(session.user.id,readWorkSelection(raw),session.impersonation?.mode==='view')},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Your progress could not be loaded. Please try again.'},{status:503});}
}
