// L5-STUB: replaced at merge
/**
 * Thin stand-in for the renderer lane's download helper, so the finish page
 * can code against the final names. It calls the existing /api/forge/download
 * (DOCX) and the old print-to-PDF window. When draft is true the file text
 * gets a DRAFT line on top and the open items at the end, so a draft is never
 * mistaken for a finished page even before the real renderer lands.
 */

import { resumeTextToStandaloneHtml } from "@/components/resume/ResumePage";

export type DownloadFormat = "pdf" | "docx" | "html";
export type DownloadKind = "resume" | "cover_letter";

export interface DownloadResumeInput {
  format: DownloadFormat;
  kind: DownloadKind;
  text: string;
  draft: boolean;
  openItems?: string[];
}

export interface DownloadPackageInput {
  resumeText: string;
  coverLetterText?: string;
  draft: boolean;
  openItems?: string[];
}

function withDraftMarks(text: string, draft: boolean, openItems?: string[]): string {
  if (!draft) return text;
  const todo = (openItems ?? []).map((i) => `- ${i}`).join("\n");
  return `DRAFT: not finished yet\n\n${text}\n\nTO DO BEFORE YOU SEND THIS (your list, not part of the resume)\n${todo}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadResume(input: DownloadResumeInput): Promise<void> {
  const content = withDraftMarks(input.text, input.draft, input.openItems);
  const base = input.kind === "resume" ? "My_Resume_SteelMan" : "My_CoverLetter_SteelMan";
  const name = input.draft ? `${base}_DRAFT` : base;
  if (input.format === "docx") {
    const res = await fetch("/api/forge/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, type: input.kind, format: "docx" }),
    });
    if (!res.ok) throw new Error("Download failed");
    save(await res.blob(), `${name}.docx`);
    return;
  }
  const html = resumeTextToStandaloneHtml(content);
  if (input.format === "html") {
    save(new Blob([html.replace(/<script>[\s\S]*?<\/script>/, "")], { type: "text/html" }), `${name}.html`);
    return;
  }
  const w = window.open("", "_blank");
  if (!w) throw new Error("Please allow popups for this site to save the PDF.");
  w.document.write(html);
  w.document.close();
}

export async function downloadPackage(input: DownloadPackageInput): Promise<void> {
  await downloadResume({ format: "docx", kind: "resume", text: input.resumeText, draft: input.draft, openItems: input.openItems });
  if (input.coverLetterText) {
    await downloadResume({ format: "docx", kind: "cover_letter", text: input.coverLetterText, draft: input.draft, openItems: input.openItems });
  }
}
