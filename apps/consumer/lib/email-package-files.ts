/**
 * The actual files for the package email (Phase 5 lane R1, review A5): the
 * resume as a PDF and a Word file, and the cover letter as a Word file, built
 * by the same renderer as every download (lib/resume-render), so the inbox
 * copy is the downloaded copy. Attached to the email (Resend takes base64
 * attachments; a finished package is a few hundred kilobytes, far under its
 * limit). Only ever called for a version the server decided is finished, so
 * the files carry no DRAFT mark.
 */

import { renderDocx, renderPdf } from "./resume-render";
import { buildResumeFilename } from "./resume-filename";
import { nameFromResumeText } from "./resume-download";
import type { MailAttachment } from "./email-package-send";

export async function packageFiles(resumeText: string, letterText: string): Promise<MailAttachment[]> {
  const name = nameFromResumeText(resumeText);
  const tokens = name.split(/\s+/).filter(Boolean);
  const naming = { firstName: tokens[0], lastName: tokens.length > 1 ? tokens.slice(1).join(" ") : undefined };
  const out: MailAttachment[] = [
    { filename: buildResumeFilename({ ...naming, kind: "resume", ext: "pdf" }), content: Buffer.from(await renderPdf({ text: resumeText, kind: "resume" })).toString("base64") },
    { filename: buildResumeFilename({ ...naming, kind: "resume", ext: "docx" }), content: Buffer.from(await renderDocx({ text: resumeText, kind: "resume" })).toString("base64") },
  ];
  if (letterText.trim()) {
    out.push({
      filename: buildResumeFilename({ ...naming, kind: "cover_letter", ext: "docx" }),
      content: Buffer.from(await renderDocx({ text: letterText, kind: "cover_letter", headerText: resumeText })).toString("base64"),
    });
  }
  return out;
}
