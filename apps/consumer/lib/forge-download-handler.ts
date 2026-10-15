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
 * DRAFT is decided HERE, on the server, never by the caller (Phase 5 lane R1,
 * review item A3). A draft page carries a small DRAFT line and a separate
 * to-do page follows, marked as not part of the resume. Three ways in:
 *   { revisionId }  a saved revision (migration 081). The server loads it as
 *                   the signed-in person (owner only), takes the resume and
 *                   letter text FROM THE REVISION, and marks DRAFT unless its
 *                   saved evidence still passes the current finish rules.
 *   { finish }      the finish page's whole state, signed out (the Forge
 *                   before the wall keeps its work in the browser). The server
 *                   runs the same gate and page measurement a saved revision
 *                   gets (lib/revision-status.ts) and decides from that.
 *   { content }     raw text. Always DRAFT. So is an unknown, foreign or
 *                   malformed revision id: the text sent is marked DRAFT.
 * A client "draft" flag can never take a mark off; it is ignored. Draft
 * downloads stay allowed and marked (D7).
 *
 * Safety limits, IP rate limiting and filename logic are unchanged.
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { NextResponse } from "next/server";
import { buildResumeFilename } from "./resume-filename";
import { MAX_RENDER_CHARS, MAX_RENDER_TOO_LARGE, cleanOpenItems, renderDocx, renderHtml, renderPdf, type RenderRequest } from "./resume-render";
import { buildZip } from "./resume-render/zip";
import { cleanRevisionInput, computeRevision, currentRevisionStatus } from "./revision-status";
import { readReceipt, readRunCookie, runCookieHash, type ReceiptContext } from "./writer-receipt";

/** Room for a finish page's whole state (its evidence), besides the text. */
const MAX_DOWNLOAD_REQUEST_BYTES = 1_000_000;
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
  /** IGNORED (kept so older clients still parse): the server decides DRAFT. */
  draft?: boolean;
  /** Plain-words list of what is left to fix, used only for raw text (always a draft). */
  openItems?: string[];
  /** A saved revision (081): the server loads it and decides from its stored status. */
  revisionId?: string;
  /** Signed out: the finish page's whole state; the server runs the gate on it. */
  finish?: Record<string, unknown>;
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

/** What the route hands in: who is signed in, and how to read their revision. */
export interface DownloadDeps {
  userId: () => Promise<string | null>;
  getRevision: (userId: string, revisionId: string) => Promise<Pick<ArtifactRevision, "id" | "status" | "resume_text" | "letter_text" | "open_items" |
    "doc_kind" | "length_choice" | "defend_answers" | "kept_terms" | "confirmed_credentials" | "evidence"> | null>;
  /** Signed in: the newest writer's receipt nonce for a run, and whether the run is the person's (review M-B). */
  receiptState?: (userId: string, runId: string) => Promise<{ newestNonce: string | null; linked: boolean }>;
}

const NO_ACCOUNT: DownloadDeps = { userId: async () => null, getRevision: async () => null };

/** What the server decided for this request. */
interface Decided {
  resume: string;
  letter: string;
  draft: boolean;
  openItems: string[];
  revisionId: string | null;
  basis: "revision" | "finish" | "raw";
}

async function decide(input: DownloadInput, deps: DownloadDeps, cookieHash: string | null = null): Promise<Decided | { error: string; status: number }> {
  const raw = typeof input.content === "string" ? input.content : "";
  const rawLetter = typeof input.coverLetter === "string" ? input.coverLetter : "";
  if (typeof input.revisionId === "string" && input.revisionId) {
    // A failure to read is said, and can be retried (review L2): never a
    // silent fall back to "no revision".
    let userId: string | null;
    let rev: Awaited<ReturnType<DownloadDeps["getRevision"]>>;
    try {
      userId = await deps.userId();
      rev = userId ? await deps.getRevision(userId, input.revisionId) : null;
    } catch {
      return { error: "We couldn't load your saved resume just now. Try again in a moment.", status: 503 };
    }
    if (rev) {
      rev = currentRevisionStatus(rev);
      return {
        resume: rev.resume_text,
        letter: rev.letter_text,
        draft: rev.status !== "finished",
        openItems: rev.status !== "finished" ? cleanOpenItems(rev.open_items) : [],
        revisionId: rev.id,
        basis: "revision",
      };
    }
    // Unknown, foreign or malformed: the text sent is a draft.
    if (!raw.trim()) return { error: "We could not find that saved resume.", status: 404 };
    return { resume: raw, letter: rawLetter, draft: true, openItems: cleanOpenItems(input.openItems), revisionId: null, basis: "raw" };
  }
  if (input.finish && typeof input.finish === "object" && !Array.isArray(input.finish)) {
    // Signed in, the receipt is checked against the account and its run's
    // newest generation; signed out, against the run the page names.
    const fin = input.finish as Record<string, unknown>;
    const runId = typeof fin.runId === "string" ? fin.runId : "";
    let ctx: ReceiptContext = { userId: null, runId, cookieHash };
    try {
      const userId = await deps.userId();
      if (userId) {
        const meta = readReceipt(fin.writerReceipt);
        const st = meta?.run && deps.receiptState ? await deps.receiptState(userId, meta.run) : { newestNonce: null, linked: false };
        ctx = { userId, runId, newestNonce: st.newestNonce, runLinked: st.linked, cookieHash };
      }
    } catch {
      return { error: "We couldn't check your resume just now. Try again in a moment.", status: 503 };
    }
    const c = cleanRevisionInput(input.finish, { receipt: ctx });
    if (!c.ok) {
      if (c.reason === "too long") return { error: MAX_RENDER_TOO_LARGE, status: 413 };
      if (!raw.trim()) return { error: "content and type are required", status: 400 };
      return { resume: raw, letter: rawLetter, draft: true, openItems: cleanOpenItems(input.openItems), revisionId: null, basis: "raw" };
    }
    const v = computeRevision(c.input);
    return { resume: c.input.resumeText, letter: c.input.letterText, draft: v.status !== "finished", openItems: cleanOpenItems(v.openItems), revisionId: null, basis: "finish" };
  }
  return { resume: raw, letter: rawLetter, draft: true, openItems: cleanOpenItems(input.openItems), revisionId: null, basis: "raw" };
}

export async function handleDownloadPost(request: Request, deps: DownloadDeps = NO_ACCOUNT) {
  try {
    const contentLength = request.headers.get("content-length");
    if (
      contentLength &&
      parseInt(contentLength, 10) > MAX_DOWNLOAD_REQUEST_BYTES
    ) {
      return NextResponse.json({ error: MAX_RENDER_TOO_LARGE }, { status: 413 });
    }

    const input: DownloadInput = await request.json();
    if (!input || typeof input !== "object") {
      return NextResponse.json({ error: "content and type are required" }, { status: 400 });
    }
    const hasSource = (typeof input.revisionId === "string" && !!input.revisionId) || (!!input.finish && typeof input.finish === "object");
    if ((!input.content && !hasSource) || !input.type) {
      return NextResponse.json(
        { error: "content and type are required" },
        { status: 400 }
      );
    }
    if (input.content !== undefined && typeof input.content !== "string") {
      return NextResponse.json({ error: "content must be text" }, { status: 400 });
    }
    if (typeof input.content === "string" && input.content.length > MAX_DOCUMENT_CHARS) {
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

    const runCookie = readRunCookie(request.headers.get("cookie"));
    const d = await decide(input, deps, runCookie ? runCookieHash(runCookie) : null);
    if ("error" in d) return NextResponse.json({ error: d.error }, { status: d.status });
    const { draft, openItems } = d;
    // What is rendered. A cover letter from a revision or a finish state is
    // that letter, with the resume as its header; raw text is what was sent.
    const fromSaved = d.basis !== "raw";
    const content = input.type === "cover_letter" && fromSaved ? d.letter : d.resume;
    const headerText = input.type === "cover_letter" ? (fromSaved ? d.resume : input.headerText) : undefined;
    if (!content.trim()) {
      return NextResponse.json({ error: input.type === "cover_letter" ? "There is no cover letter in this version." : "There is nothing to download yet." }, { status: 400 });
    }
    const stamp = (res: Response): Response => {
      res.headers.set("X-SMR-Status", draft ? "draft" : "finished");
      if (d.revisionId) res.headers.set("X-SMR-Revision", d.revisionId);
      return res;
    };

    if (format === "txt") {
      const text = draft ? `DRAFT\n\n${content}` : content;
      return stamp(attachment(new Blob([text], { type: "text/plain" }), "text/plain", resolveDownloadFilename(input, "txt")));
    }

    const req: RenderRequest = {
      text: content,
      kind: input.type,
      draft,
      openItems,
      headerText,
    };

    if (format === "pdf") {
      const bytes = await renderPdf(req);
      return stamp(attachment(new Uint8Array(bytes), "application/pdf", resolveDownloadFilename(input, "pdf")));
    }
    if (format === "html") {
      return stamp(attachment(renderHtml(req), "text/html; charset=utf-8", resolveDownloadFilename(input, "html")));
    }
    if (format === "zip") {
      // One click: resume PDF + Word, and the cover letter in Word when there is one.
      const resumeReq: RenderRequest = { text: d.resume, kind: "resume", draft, openItems };
      const entries = [
        { name: resolveDownloadFilename(input, "pdf", "resume"), data: new Uint8Array(await renderPdf(resumeReq)) },
        { name: resolveDownloadFilename(input, "docx", "resume"), data: new Uint8Array(await renderDocx(resumeReq)) },
      ];
      if (d.letter.trim()) {
        const letterReq: RenderRequest = { text: d.letter, kind: "cover_letter", draft, openItems: [], headerText: d.resume };
        entries.push({ name: resolveDownloadFilename(input, "docx", "cover_letter"), data: new Uint8Array(await renderDocx(letterReq)) });
      }
      const zip = buildZip(entries);
      const base = resolveDownloadFilename(input, "zip", "resume");
      return stamp(attachment(new Uint8Array(zip), "application/zip", base));
    }

    const buffer = await renderDocx(req);
    return stamp(attachment(
      new Uint8Array(buffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      resolveDownloadFilename(input, "docx")
    ));
  } catch (error: any) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Failed to generate document." },
      { status: 500 }
    );
  }
}

