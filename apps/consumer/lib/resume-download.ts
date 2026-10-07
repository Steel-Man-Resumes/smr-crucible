/**
 * Client helpers: download the resume, cover letter or a whole package.
 *
 *   downloadResume({ format, kind, text, draft, openItems })
 *   downloadPackage({ resumeText, coverLetterText, draft, openItems })
 *
 * Both post to /api/forge/download, which builds every format from one layout
 * model (PDF, Word, HTML). The file is named with buildResumeFilename. The
 * caller decides draft versus finished (the finish page, from the engine's
 * getResumeStatus) and passes the flag; these helpers never decide it.
 *
 * Both reject with an Error whose message is plain words the page can show
 * (for example the rate limit message). They resolve once the browser has been
 * handed the file.
 */

import { buildResumeFilename } from "./resume-filename";

export type DownloadFormat = "pdf" | "docx" | "html";

export interface DownloadResumeOptions {
  format: DownloadFormat;
  kind: "resume" | "cover_letter";
  text: string;
  /** True: DRAFT line on every page and a to-do page after the resume. */
  draft: boolean;
  /** Plain-words list of what is left to fix. Used when draft is true. */
  openItems?: string[];
  /** Cover letter only: the resume text, so the letter carries the name and contact line. */
  resumeText?: string;
  /** Optional naming pieces. The name is read from the top of the resume text when absent. */
  name?: string;
  lane?: string;
  company?: string;
  role?: string;
}

export interface DownloadPackageOptions {
  resumeText: string;
  coverLetterText?: string;
  draft: boolean;
  openItems?: string[];
  name?: string;
  lane?: string;
  company?: string;
  role?: string;
}

/** The person's name from the first meaningful line of a resume, in normal capitals. */
export function nameFromResumeText(text: string): string {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) || "";
  if (!first || /[@|\d]/.test(first) || first.length > 60) return "";
  return first
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function namingParts(o: { name?: string; lane?: string; company?: string; role?: string }, sourceText: string) {
  const name = (o.name && o.name.trim()) || nameFromResumeText(sourceText);
  const tokens = name.split(/\s+/).filter(Boolean);
  return {
    firstName: tokens[0],
    lastName: tokens.length > 1 ? tokens.slice(1).join(" ") : undefined,
    lane: o.lane,
    company: o.company,
    role: o.role,
    name: name || undefined,
  };
}

async function fetchFile(body: Record<string, unknown>): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch("/api/forge/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("We could not reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = "The download did not work. Please try again.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* keep the plain message */
    }
    throw new Error(message);
  }
  return res.blob();
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadResume(opts: DownloadResumeOptions): Promise<void> {
  if (!opts.text || !opts.text.trim()) throw new Error("There is nothing to download yet.");
  const naming = namingParts(opts, opts.kind === "cover_letter" ? opts.resumeText || "" : opts.text);
  const blob = await fetchFile({
    content: opts.text,
    type: opts.kind,
    format: opts.format,
    draft: opts.draft === true,
    openItems: opts.draft ? opts.openItems || [] : [],
    headerText: opts.kind === "cover_letter" ? opts.resumeText : undefined,
    name: naming.name,
    lane: naming.lane,
    company: naming.company,
    role: naming.role,
  });
  saveBlob(blob, buildResumeFilename({ ...naming, kind: opts.kind, ext: opts.format }));
}

export async function downloadPackage(opts: DownloadPackageOptions): Promise<void> {
  if (!opts.resumeText || !opts.resumeText.trim()) throw new Error("There is nothing to download yet.");
  const naming = namingParts(opts, opts.resumeText);
  const blob = await fetchFile({
    content: opts.resumeText,
    type: "resume",
    format: "zip",
    coverLetter: opts.coverLetterText && opts.coverLetterText.trim() ? opts.coverLetterText : undefined,
    draft: opts.draft === true,
    openItems: opts.draft ? opts.openItems || [] : [],
    name: naming.name,
    lane: naming.lane,
    company: naming.company,
    role: naming.role,
  });
  saveBlob(blob, buildResumeFilename({ ...naming, kind: "resume", ext: "zip" }));
}
