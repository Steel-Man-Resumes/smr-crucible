/**
 * Document download handler (used by app/api/forge/download/route.ts, kept in lib so tests can call it without the rate limiter): turns the Forge's plain resume (or cover letter) text
 * into a file that looks the same in every format.
 *
 * Formats: pdf (real selectable text, fonts embedded), docx (Word, one column,
 * no tables, no header or footer text), html (self-contained, fonts embedded),
 * txt, and zip (resume PDF and Word plus the cover letter in Word, one click).
 *
 * All of them come from ONE layout model in lib/resume-render, set with real
 * font metrics (Carlito and Caladea, the metric twins of Calibri and Cambria),
 * so pages break in the same places. Nothing here rewrites a word.
 *
 * DRAFT: the caller passes { draft, openItems }. When draft is true every page
 * carries a small DRAFT line and a separate to-do page follows, marked as not
 * part of the resume. This route never decides draft versus finished.
 *
 * Safety limits, IP rate limiting and filename logic are unchanged.
 */

import { NextResponse } from "next/server";
import { buildResumeFilename } from "./resume-filename";
import { MAX_RENDER_CHARS, MAX_RENDER_TOO_LARGE, cleanOpenItems, renderDocx, renderHtml, renderPdf, type RenderRequest } from "./resume-render";
import { buildZip } from "./resume-render/zip";

const MAX_DOWNLOAD_REQUEST_BYTES = 250_000;
const MAX_DOCUMENT_CHARS = MAX_RENDER_CHARS;

type DownloadFormat = "docx" | "txt" | "pdf" | "html" | "zip";
const FORMATS: ReadonlySet<string> = new Set(["docx", "txt", "pdf", "html", "zip"]);

interface DownloadInput {
  content: string;
  type: "resume" | "cover_letter";
  format?: DownloadFormat;
  // Optional naming inputs (Phase 2.6). When supplied, the download is named
  // First-Last--Lane--Company--Role.<ext> instead of a generic constant. Any
  // missing piece collapses out cleanly; nothing known falls back to
  // "Resume"/"CoverLetter" -- never a bare "document".
  name?: string;
  firstName?: string;
  lastName?: string;
  lane?: string;
  company?: string;
  role?: string;
  meta?: { targetCompany?: string; targetJob?: string; lane?: string };
  /** DRAFT mark: set by the caller, never decided here. */
  draft?: boolean;
  /** Plain-words list of what is left to fix (draft only). */
  openItems?: string[];
  /** Cover letter: the resume text, used for the name and contact header. */
  headerText?: string;
  /** format "zip": the cover letter text to include in Word. */
  coverLetter?: string;
}

/**
 * Derive the download filename from whatever naming inputs the caller passed.
 * first/last come from explicit fields or by splitting `name`; company/role
 * fall back to meta.targetCompany / meta.targetJob.
 */
function resolveDownloadFilename(input: DownloadInput, ext: string, kind: "resume" | "cover_letter" = input.type): string {
  let firstName = input.firstName;
  let lastName = input.lastName;
  if ((!firstName || !lastName) && typeof input.name === "string" && input.name.trim()) {
    const tokens = input.name.trim().split(/\s+/);
    firstName = firstName || tokens[0];
    lastName = lastName || (tokens.length > 1 ? tokens.slice(1).join(" ") : undefined);
  }
  return buildResumeFilename({
    firstName,
    lastName,
    lane: input.lane || input.meta?.lane,
    company: input.company || input.meta?.targetCompany,
    role: input.role || input.meta?.targetJob,
    kind: kind === "cover_letter" ? "cover_letter" : "resume",
    ext,
  });
}

function attachment(body: BodyInit, contentType: string, fileName: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function handleDownloadPost(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (
      contentLength &&
      parseInt(contentLength, 10) > MAX_DOWNLOAD_REQUEST_BYTES
    ) {
      return NextResponse.json({ error: MAX_RENDER_TOO_LARGE }, { status: 413 });
    }

    const input: DownloadInput = await request.json();

    if (!input.content || !input.type) {
      return NextResponse.json(
        { error: "content and type are required" },
        { status: 400 }
      );
    }
    if (typeof input.content !== "string") {
      return NextResponse.json({ error: "content must be text" }, { status: 400 });
    }
    if (input.content.length > MAX_DOCUMENT_CHARS) {
      return NextResponse.json({ error: MAX_RENDER_TOO_LARGE }, { status: 413 });
    }
    if (input.type !== "resume" && input.type !== "cover_letter") {
      return NextResponse.json({ error: "invalid document type" }, { status: 400 });
    }
    for (const extra of [input.headerText, input.coverLetter]) {
      if (extra !== undefined && typeof extra !== "string") {
        return NextResponse.json({ error: "text fields must be text" }, { status: 400 });
      }
      if (typeof extra === "string" && extra.length > MAX_DOCUMENT_CHARS) {
        return NextResponse.json({ error: MAX_RENDER_TOO_LARGE }, { status: 413 });
      }
    }

    const format = (input.format || "docx") as string;
    if (!FORMATS.has(format)) {
      return NextResponse.json({ error: "invalid format" }, { status: 400 });
    }
    const draft = input.draft === true;
    const openItems = draft ? cleanOpenItems(input.openItems) : [];

    if (format === "txt") {
      const text = draft ? `DRAFT\n\n${input.content}` : input.content;
      return attachment(new Blob([text], { type: "text/plain" }), "text/plain", resolveDownloadFilename(input, "txt"));
    }

    const req: RenderRequest = {
      text: input.content,
      kind: input.type,
      draft,
      openItems,
      headerText: input.headerText,
    };

    if (format === "pdf") {
      const bytes = await renderPdf(req);
      return attachment(new Uint8Array(bytes), "application/pdf", resolveDownloadFilename(input, "pdf"));
    }
    if (format === "html") {
      return attachment(renderHtml(req), "text/html; charset=utf-8", resolveDownloadFilename(input, "html"));
    }
    if (format === "zip") {
      // One click: resume PDF + Word, and the cover letter in Word when there is one.
      const resumeReq: RenderRequest = { text: input.content, kind: "resume", draft, openItems };
      const entries = [
        { name: resolveDownloadFilename(input, "pdf", "resume"), data: new Uint8Array(await renderPdf(resumeReq)) },
        { name: resolveDownloadFilename(input, "docx", "resume"), data: new Uint8Array(await renderDocx(resumeReq)) },
      ];
      if (typeof input.coverLetter === "string" && input.coverLetter.trim()) {
        const letterReq: RenderRequest = { text: input.coverLetter, kind: "cover_letter", draft, openItems: [], headerText: input.content };
        entries.push({ name: resolveDownloadFilename(input, "docx", "cover_letter"), data: new Uint8Array(await renderDocx(letterReq)) });
      }
      const zip = buildZip(entries);
      const base = resolveDownloadFilename(input, "zip", "resume");
      return attachment(new Uint8Array(zip), "application/zip", base);
    }

    const buffer = await renderDocx(req);
    return attachment(
      new Uint8Array(buffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      resolveDownloadFilename(input, "docx")
    );
  } catch (error: any) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Failed to generate document." },
      { status: 500 }
    );
  }
}

