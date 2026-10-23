import { getOneAsUser, getArtifact, getRevision, getLatestRevision } from '@crucible/core';
import { revisionIsCurrent } from './revision-current';
import { currentRevisionStatus } from './revision-status';
import type { JobPackage } from './job-package-email';
export async function loadJobPackage(userId:string,applicationId:string,revisionId:string):Promise<JobPackage|null>{
  const [app,stored]=await Promise.all([
    getOneAsUser<JobPackage['application']>(userId,'SELECT id, job_title, company, resume_artifact_id FROM job_application WHERE id=$1 AND user_id=$2',[applicationId,userId]),
    getRevision(userId,revisionId),
  ]);
  if(!app || !stored || stored.user_id!==userId || app.resume_artifact_id!==stored.artifact_id)return null;
  const [artifact,latest]=await Promise.all([getArtifact(stored.artifact_id,userId),getLatestRevision(userId,stored.artifact_id)]);
  if(!latest || latest.id!==stored.id)return null;
  if(!artifact || artifact.is_demo || artifact.artifact_type!=='resume')return null;
  const content=artifact.content && typeof artifact.content==='object' ? artifact.content as Record<string,unknown> : {};
  const job=content.jobPackage && typeof content.jobPackage==='object' ? content.jobPackage as Record<string,unknown> : null;
  if(job && job.applicationId!==app.id)return null;
  const letter=job && typeof job.coverLetterText==='string' ? job.coverLetterText : undefined;
  if(job && letter===undefined)return null;
  if(!revisionIsCurrent(artifact.content,stored,letter))return null;
  const target=artifact.target_context || {};
  // Explicit links must agree; a reusable baseline may have no application link.
  if(typeof target.applicationId==='string' && target.applicationId!==app.id)return null;
  const comparable=(v:string)=>v.trim().toLocaleLowerCase();
  if(typeof target.targetJob==='string' && target.targetJob.trim() && comparable(target.targetJob)!==comparable(app.job_title))return null;
  if(typeof target.targetCompany==='string' && target.targetCompany.trim() && comparable(target.targetCompany)!==comparable(app.company))return null;
  return {application:app,revision:currentRevisionStatus(stored)};
}
