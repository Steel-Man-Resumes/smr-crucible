/** Page and coach call the same typed search core. Personal filters run after shared cache reads. */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { runJobSearch } from "@/lib/job-search-core";
import { InvalidJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
export const maxDuration=60;
async function handlePost(request:Request){
  if(Number(request.headers.get("content-length")||0)>32000)return NextResponse.json({error:"Request too large"},{status:413});
  try{
    const body=await request.json();
    if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Invalid search"},{status:400});
    if((body.targetRole!==undefined&&(typeof body.targetRole!=="string"||body.targetRole.length>200))||(body.location!==undefined&&(typeof body.location!=="string"||body.location.length>200)))return NextResponse.json({error:"Use a short role and city or ZIP."},{status:400});
    const session=await auth();
    const result=await runJobSearch({role:body.targetRole,location:body.location,skills:body.skills,hasRecord:body.hasRecord===true,userId:session?.user?.id||null,laneId:body.laneId,filters:body.filters});
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof InvalidJobSearchFilters)return NextResponse.json({error:"invalid_filters",message:error.message},{status:400});
    console.error("Job search failed:",error instanceof Error?error.name:"Unknown error");
    return NextResponse.json({jobs:[],fair_chance_info:"",error:"search_failed"},{status:503});
  }
}
export const POST=withRateLimit(handlePost,{mode:"user",endpoint:"jobs",requiredTier:"client"});
