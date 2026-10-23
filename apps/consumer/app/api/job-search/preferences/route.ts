import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { loadJobSearchPreferences, saveJobSearchPreferences } from "@/lib/job-search-preferences";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request){
  const caller=await revisionCaller();if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status,headers});
  try{return NextResponse.json(await loadJobSearchPreferences(caller.userId,new URL(request.url).searchParams.get("laneId")??undefined),{headers});}
  catch{return NextResponse.json({error:"Your search preferences could not be loaded. Try again before changing lanes."},{status:409,headers});}
}
export async function POST(request:Request){
  if(!isSameOriginJsonPost(request.headers))return NextResponse.json({error:"Not allowed"},{status:403,headers});
  const caller=await revisionCaller();if(!caller.ok)return NextResponse.json({error:caller.error},{status:caller.status,headers});
  const text=await request.text();if(text.length>16000)return NextResponse.json({error:"Too many search choices."},{status:413,headers});
  try{const body=JSON.parse(text);const result=await saveJobSearchPreferences(caller.userId,body);return result?NextResponse.json(result,{headers}):NextResponse.json({error:"These preferences changed in another tab. Reload before saving."},{status:409,headers});}
  catch{return NextResponse.json({error:"Your search choices did not save. Check the filters and try again."},{status:400,headers});}
}
