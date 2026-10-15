import {runAsUser} from './db';
import {getArtifact} from './refineryArtifact';
import {getVerifiedResource,getApprovedResourceChain} from './directoryPublication';
import {ResourceListContent,ResourceListSelection} from './resourceListShared';
export * from './resourceListShared';
/** Saves choices, never service receipt, sensitive context, or a stale fact snapshot. */
export async function saveResourceList(userId:string,input:{serviceIds:string[];chainKeys?:string[]}) {
 const selection=ResourceListSelection.parse(input);
 selection.serviceIds.sort();selection.chainKeys.sort();
 const services=await Promise.all([...new Set(selection.serviceIds)].map(async id=>{
  const result=await getVerifiedResource(id);if(result.status!=='ok')throw new Error('directory_unavailable');
  if(!result.data)throw new Error('resource_no_longer_available');return {id,version:result.data.version};
 }));
 const chains=await Promise.all([...new Set(selection.chainKeys)].map(async key=>{
  const result=await getApprovedResourceChain(key);if(result.status!=='ok')throw new Error('directory_unavailable');
  if(!result.data.length)throw new Error('chain_no_longer_available');return {key,versions:result.data.map(s=>s.version)};
 }));
 const content=ResourceListContent.parse({schemaVersion:1,services,chains});
 const json=JSON.stringify(content);
 // The lock and read/write are separate statements in one ReadCommitted transaction:
 // a concurrent retry sees the committed first save after taking the same lock.
 const result=await runAsUser<unknown[][]>(userId,c=>[
  c("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[userId,json]),
  c(`WITH existing AS (SELECT id FROM refinery_artifact WHERE user_id=$1 AND artifact_type='resource_list' AND content=$2::jsonb ORDER BY created_at DESC LIMIT 1),
   made AS (INSERT INTO refinery_artifact(user_id,artifact_type,target_context,content,iteration_number,scaffold_level)
    SELECT $1,'resource_list','{}'::jsonb,$2::jsonb,coalesce((SELECT max(iteration_number) FROM refinery_artifact WHERE user_id=$1 AND artifact_type='resource_list'),0)+1,1
    WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id)
   SELECT id FROM existing UNION ALL SELECT id FROM made`,[userId,json]),
 ],{isolationLevel:'ReadCommitted'});
 const artifact=(result[1] as {id:string}[])[0];if(!artifact)throw new Error('save_unavailable');
 return {artifactId:artifact.id};
}
/** Reopening always resolves current publication; withdrawn records return no old facts. */
export async function reopenResourceList(userId:string,artifactId:string) {
 const artifact=await getArtifact(artifactId,userId);
 if(!artifact||artifact.artifact_type!=='resource_list')return null;
 const parsed=ResourceListContent.safeParse(artifact.content);
 if(!parsed.success)return {artifactId,status:'invalid' as const,services:[],chains:[]};
 const services=await Promise.all(parsed.data.services.map(async saved=>{
  const result=await getVerifiedResource(saved.id);
  return {id:saved.id,status:result.status==='unavailable'?'unavailable':!result.data?'withdrawn_or_expired':result.data.version===saved.version?'current':'changed',data:result.data};
 }));
 const chains=await Promise.all(parsed.data.chains.map(async saved=>{
  const result=await getApprovedResourceChain(saved.key);
  return {key:saved.key,status:result.status==='unavailable'?'unavailable':!result.data.length?'withdrawn_or_expired':JSON.stringify(result.data.map(s=>s.version))===JSON.stringify(saved.versions)?'current':'changed',data:result.data};
 }));
 return {artifactId,status:services.some(x=>x.status==='unavailable')||chains.some(x=>x.status==='unavailable')?'unavailable' as const:'ok' as const,services,chains};
}
