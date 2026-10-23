import { createHash } from 'node:crypto';
import type { ArtifactRevision } from '@crucible/core/src/artifactRevision';
import type { MailAttachment, MailTransport, PackageMail } from './email-package-send';
import { EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY, RECIPIENT_ENDPOINT, recipientKey } from './email-package-guard';

export interface JobPackage {
  application: { id: string; job_title: string; company: string; resume_artifact_id: string | null };
  revision: ArtifactRevision;
}
export interface JobPackageDeps {
  load(userId: string, applicationId: string, revisionId: string): Promise<JobPackage | null>;
  target(userId: string): Promise<{email: string | null; proven: boolean; on: boolean} | null>;
  claim(userId: string, key: string): Promise<boolean | null | 'busy' | 'uncertain'>;
  release(userId: string, key: string): Promise<void>;
  prepare(userId: string, key: string, mail: PackageMail): Promise<PackageMail>;
  complete(userId: string, key: string): Promise<void>;
  count(key: string, endpoint: string): Promise<number>;
  files(packet: JobPackage): Promise<MailAttachment[]>;
  transport: MailTransport | null;
  from: string;
}
export interface JobPackageResult { ok: boolean; status: 'accepted' | 'already' | 'pending' | 'unavailable' | 'not_found' | 'unproven' | 'off' | 'limit' | 'changed' | 'failed'; revisionId?: string; draft?: boolean; message: string }
const result = (status: JobPackageResult['status'], message: string): JobPackageResult => ({ok:false,status,message});
const label = (s: string) => s.replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, 160);
const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function jobPackageVersion(userId: string, p: JobPackage): string {
  return createHash('sha256').update(JSON.stringify(['refinery-job-package-v1',userId,p.application.id,p.application.job_title,p.application.company,p.revision.id,p.revision.content_hash,p.revision.status])).digest('hex');
}
export function buildJobPackageEmail(p: JobPackage): Pick<PackageMail,'subject'|'text'|'html'> {
  const role=label(p.application.job_title)||'Your saved role', company=label(p.application.company)||'Your saved employer';
  const draft=p.revision.status!=='finished';
  const appUrl=`https://refinery.steelmanresumes.com/dashboard/application-tailor?id=${encodeURIComponent(p.revision.artifact_id)}`;
  const paragraphs=[
    `Job search delivery 1: ${company} / ${role}`,
    `This package is for ${role} at ${company}, saved revision ${p.revision.revision_number}. Emailing it to yourself does not submit an application.`,
    draft ? 'This saved version is marked DRAFT. Open your private workspace to review the remaining questions with t.ROY before sending it to an employer.' : 'Your saved resume files are attached. Review the contact details and make sure you can explain the work in your own words.',
    '1. Save the attached resume PDF and Word file. Use the format the employer requests.',
    p.revision.letter_text.trim() ? '2. The cover letter saved with this revision is attached as PDF and Word files. Use it only for this employer and role; check the greeting before sending.' : '2. No cover letter is saved with this revision. Open the package in Refinery if you want to add one.',
    '3. Open your saved application in Refinery, then use its employer application link. Attach the requested files and complete the employer’s questions.',
    '4. After you actually submit, mark the application sent in Refinery so your next action is easy to find.',
    'We strongly recommend a guided line-by-line review with t.ROY. Add the real details only you know, strengthen the wording together, and practice explaining it. Keep those confirmed facts in your Master Draft for future applications.',
    `Open your package: ${appUrl}`,
    'Disclosure planning and private coaching notes are not attached. Find them inside your signed-in Refinery workspace.',
    'You requested this package through your Steel Man Resumes account. Your saved work remains available in Refinery.',
  ];
  return {subject:`Job search delivery 1: ${company} - ${role}${draft?' (draft)':''}`,text:paragraphs.join('\n\n'),html:`<div style="max-width:640px;margin:auto;font-family:Arial,sans-serif;line-height:1.6;color:#252130">${paragraphs.map((s,i)=>i===0?`<h1 style="font-size:22px;color:#6949a8">${esc(s)}</h1>`:`<p>${esc(s)}</p>`).join('')}<p><a href="${appUrl}">Open this package with t.ROY</a></p></div>`};
}
export async function sendJobPackage(userId: string, applicationId: string, revisionId: string, deps: JobPackageDeps): Promise<JobPackageResult> {
  const packet=await deps.load(userId,applicationId,revisionId);
  if(!packet || packet.revision.user_id!==userId || packet.application.id!==applicationId || packet.revision.id!==revisionId || packet.application.resume_artifact_id!==packet.revision.artifact_id) return result('not_found','That saved application package is unavailable. Reopen it and try again.');
  const target=await deps.target(userId);
  if(!target?.email || !target.proven) return result('unproven','Confirm your account email before sending attachments. Your downloads remain available.');
  // Keep the existing account package preference effective for this route too.
  if(!target.on) return result('off','Package email is turned off in Settings. You can still download these files.');
  if(!deps.transport) return result('unavailable','Email is unavailable right now. Download your files instead.');
  const version=jobPackageVersion(userId,packet), claim=await deps.claim(userId,version);
  if(claim===false) return {ok:true,status:'already',revisionId,draft:packet.revision.status!=='finished',message:'This exact saved package was already accepted for delivery. Check your inbox and spam folder.'};
  if(claim!==true) return result(claim===null?'unavailable':'pending',claim===null?'Reliable email delivery is unavailable. Download your package instead.':'This delivery is being checked. Please wait before trying again. Your downloads are available.');
  let attempted=false;
  try {
    if(await deps.count(recipientKey(target.email),RECIPIENT_ENDPOINT)>EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY) return result('limit','Your package email allowance is used for today. Download your files or try tomorrow.');
    const attachments=await deps.files(packet);
    const candidate:PackageMail={from:deps.from,to:target.email,...buildJobPackageEmail(packet),attachments,idempotencyKey:`refinery-job-package-${version}`};
    const outgoing=await deps.prepare(userId,version,candidate);
    const [finalTarget,finalPacket]=await Promise.all([deps.target(userId),deps.load(userId,applicationId,revisionId)]);
    if(!finalTarget?.proven || !finalTarget.on || finalTarget.email!==target.email || outgoing.to!==target.email || !finalPacket || jobPackageVersion(userId,finalPacket)!==version) return result('changed','The account or saved package changed. Reopen it before sending.');
    attempted=true;
    const response=await deps.transport(outgoing);
    if(!response.ok) return result('pending','The email provider has not confirmed acceptance. Your files remain available to download.');
    // An accepted send remains accepted even if recording completion must retry.
    await deps.complete(userId,version).catch(()=>console.error('JOB_PACKAGE_COMPLETION_PENDING'));
    return {ok:true,status:'accepted',revisionId,draft:packet.revision.status!=='finished',message:'Your saved package was accepted for delivery to your account email. Check your inbox and spam folder.'};
  } catch { return result(attempted?'pending':'failed',attempted?'Delivery has not been confirmed. Your downloads remain available.':'We couldn’t prepare the email. Your saved files are still available.'); }
  finally { if(!attempted) await deps.release(userId,version).catch(()=>{}); }
}
