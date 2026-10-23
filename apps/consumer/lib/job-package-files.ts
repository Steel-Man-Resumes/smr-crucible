import { renderDocx, renderPdf } from './resume-render';
import { buildResumeFilename } from './resume-filename';
import { nameFromResumeText } from './resume-download';
import type { JobPackage } from './job-package-email';
import type { MailAttachment } from './email-package-send';
export async function jobPackageFiles(packet: JobPackage, options: {resumePdfOnly?:boolean;kind?:'resume'|'cover_letter';format?:'pdf'|'docx'} = {}): Promise<MailAttachment[]> {
  const {revision:rev,application:app}=packet;
  const tokens=nameFromResumeText(rev.resume_text).split(/\s+/).filter(Boolean);
  const naming={firstName:tokens[0],lastName:tokens.slice(1).join(' '),company:app.company,role:app.job_title};
  const draft=rev.status!=='finished';
  const docs:Array<{kind:'resume'|'cover_letter';text:string}>=[{kind:'resume',text:rev.resume_text}];
  if(!options.resumePdfOnly && rev.letter_text.trim())docs.push({kind:'cover_letter',text:rev.letter_text});
  const files:MailAttachment[]=[];
  for(const doc of docs.filter(d=>!options.kind||d.kind===options.kind))for(const ext of (options.format ? [options.format] : options.resumePdfOnly ? ['pdf'] : ['pdf','docx']) as Array<'pdf'|'docx'>){
    // No open-items checklist: it can contain private coaching/disclosure notes.
    const input={text:doc.text,kind:doc.kind,headerText:doc.kind==='cover_letter'?rev.resume_text:undefined,draft,openItems:[]};
    const bytes=ext==='pdf'?await renderPdf(input):await renderDocx(input);
    const filename=buildResumeFilename({...naming,kind:doc.kind,ext});
    files.push({filename:draft?filename.replace(/\.(pdf|docx)$/,'-DRAFT.$1'):filename,content:Buffer.from(bytes).toString('base64')});
  }
  return files;
}
