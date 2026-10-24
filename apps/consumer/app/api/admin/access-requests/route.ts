import { requirePlatformAdmin } from '@/lib/org-guard';
import { listAccessRequests,decideAccessRequest,readProgressionPolicy } from '@/lib/progression-server';
import { isSameOriginJsonPost } from '@/lib/same-origin';
import { SeatDecisionError } from '@/lib/refinery-access-server';
export async function GET(){const g=await requirePlatformAdmin();if(!g.ok)return g.response;
 try{return Response.json({requests:await listAccessRequests(g.userId),policy:await readProgressionPolicy(g.userId)},{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'The queue could not be loaded.'},{status:503});}}
export async function POST(request:Request){if(!isSameOriginJsonPost(request.headers))return Response.json({error:'Request not allowed.'},{status:403});const g=await requirePlatformAdmin();if(!g.ok)return g.response;
 try{const text=await request.text();if(text.length>3000)return Response.json({error:'Request too long.'},{status:413});const b=JSON.parse(text);return Response.json(await decideAccessRequest(g.userId,String(b.id??''),String(b.decision??''),String(b.note??''),new URL(request.url).origin));}catch(error){if(error instanceof SeatDecisionError)return Response.json({error:error.message},{status:409});return Response.json({error:'The decision could not be applied. Check the request and bonus limits, then retry.'},{status:409});}}
