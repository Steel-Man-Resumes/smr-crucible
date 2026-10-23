import { auth } from '@/auth';
import { requestProgressionAccess } from '@/lib/progression-server';
import { isSameOriginJsonPost } from '@/lib/same-origin';
export async function POST(request:Request){
 if(!isSameOriginJsonPost(request.headers))return Response.json({error:'Request not allowed.'},{status:403});
 const session=await auth();if(!session?.user?.id)return Response.json({error:'Please sign in.'},{status:401});
 try {const text=await request.text();if(text.length>6000)return Response.json({error:'Keep the request brief.'},{status:413});
 return Response.json(await requestProgressionAccess(session.user.id,JSON.parse(text)),{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'The request could not be saved. Check the details and try again.'},{status:400});}
}
