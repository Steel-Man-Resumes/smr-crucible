/**
 * Text extraction pipeline — ported from smr-forge/lib/textExtraction.ts
 *
 * Bulletproof parser: accepts ANY format with intelligent fallbacks.
 * Runs server-side only (uses Node APIs: pdf-parse, mammoth, tesseract.js)
 *
 * Supported formats:
 * - PDF (text extraction + OCR fallback)
 * - DOCX/DOC (mammoth + plain text fallback)
 * - Images: PNG, JPG, JPEG, HEIC, HEIF, WEBP, BMP, GIF, TIFF (OCR)
 * - Plain text / RTF / HTML-ish exports
 * - Unknown formats (text sniff + OCR as last resort)
 */

import { UnsafeUploadError, assertSafePdf, safeDocxForMammoth } from "./upload-safety";
import { ExtractAborted, extractInWorker } from "./extract-worker";

/**
 * pdf.js and mammoth run in a worker with a heap limit, terminated when these
 * budgets run out (lib/extract-worker.ts, security review 3a r5). The checks in
 * lib/upload-safety.ts still run first either way. FORGE_EXTRACT_IN_THREAD=1 is
 * an emergency switch back to reading in the request's own thread.
 */
const PDF_TEXT_BUDGET_MS = 20_000;
const DOCX_TEXT_BUDGET_MS = 15_000;
const inThread = () => process.env.FORGE_EXTRACT_IN_THREAD === "1";

const MIN_EXTRACTED_CHARS = 10;
const MIN_MEANINGFUL_CHARS = 20;
const MAX_PDF_OCR_PAGES = 5;
const OCR_CACHE_PATH = "/tmp/tesseract-cache";

/**
 * Hard ceiling on OCR, well under /api/parse's maxDuration (60 s), so a stalled
 * OCR becomes a clear 422 ("couldn't read that image") instead of the
 * platform's 504. The AI parse after OCR has its own ceiling in the route.
 *
 * Why a ceiling at all: tesseract.js watches its Node worker thread through
 * `worker.onerror`, a browser property Node's worker_threads ignores. If the
 * worker thread fails to start (bad worker path, missing module), createWorker()
 * never resolves or rejects. That silent hang was the 504 on image uploads
 * (2026-10-02). next.config.mjs fixes the cause; this bounds any recurrence.
 */
const OCR_TIMEOUT_MS = 25_000;

class OcrTimeoutError extends Error {
  constructor(ms: number) {
    super(`OCR did not finish within ${ms} ms`);
    this.name = "OcrTimeoutError";
  }
}

function withOcrTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError(ms)), ms);
  });
  // race() subscribes to `work`, so a late rejection is handled, never unhandled.
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Thrown when a document genuinely can't be read (scanned/image-only PDF, a
 * photo OCR couldn't parse, an unreadable format). The parse route maps this to
 * a friendly 422 that steers the user to paste or the guided builder -- never a
 * generic 500 "something went wrong."
 */
export class UnreadableDocumentError extends Error {
  readonly code = "UNREADABLE_DOCUMENT";
  constructor(message: string) {
    super(message);
    this.name = "UnreadableDocumentError";
  }
}

/** The worker ran out of time or memory: refused, never retried another way (no OCR). */
export class ReadAbortedError extends UnreadableDocumentError {
  constructor() {
    super("That file took too long to read. Try a PDF or Word file, or paste the text.");
    this.name = "ReadAbortedError";
  }
}

/** Buffers already scanned and found safe, so each PDF is scanned once (hotfix F8). */
const scannedSafe = new WeakSet<Buffer>();

/** A PDF checked before any reader opens it (lib/upload-safety.ts); unsafe = unreadable. */
function assertPdfSafe(buffer: Buffer) {
  if (scannedSafe.has(buffer)) return;
  try {
    assertSafePdf(buffer);
    scannedSafe.add(buffer);
  } catch (e) {
    if (e instanceof UnsafeUploadError) throw new UnreadableDocumentError(e.message);
    throw e;
  }
}

/** A zip archive (a .docx), by its first bytes. */
function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/** The file's extension for logs, never its name. */
function fileKindForLog(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/.exec(name);
  return m ? `.${m[1]}` : "(no extension)";
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const name = fileName.toLowerCase();

  // Never the file's name: it is usually the person's full name (hotfix F7).
  console.log(`Extracting text: ${fileKindForLog(name)} (${mimeType}), ${buffer.length} bytes`);

  try {
    // PDF
    if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
      // Before pdf.js or the OCR renderer sees it (security review 3a r2, H1).
      assertPdfSafe(buffer);
      try {
        const text = await extractFromPDF(buffer);
        if (hasMeaningfulText(text)) return text;
        console.log("PDF text minimal, trying OCR fallback...");
      } catch (error) {
        if (error instanceof ReadAbortedError) throw error;
        console.log("PDF extraction failed, falling back to OCR:", error);
      }
      return await extractFromPDFWithOCR(buffer);
    }

    // DOCX/DOC
    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword" ||
      name.endsWith(".docx") ||
      name.endsWith(".doc")
    ) {
      // Only a zip (a real .docx) goes to mammoth. HTML or RTF saved as
      // .doc, and .rtf files labelled msword, are read as text below, as
      // before (hotfix F2).
      if (isZip(buffer)) {
        try {
          const text = await extractFromDOCX(buffer);
          if (text.trim().length > MIN_EXTRACTED_CHARS) return text;
        } catch (error) {
          // A Word file that fails the safety check is refused, never read as
          // loose text (security review 3a r2, H1).
          if (error instanceof UnsafeUploadError) throw new UnreadableDocumentError(error.message);
          if (error instanceof ReadAbortedError) throw error;
          console.log("DOCX extraction failed:", error);
        }
      }
      // Fallback: try as plain text
      const text = extractLikelyText(buffer);
      if (text.trim().length > MIN_EXTRACTED_CHARS) return text;
    }

    // Images (OCR)
    if (
      mimeType.startsWith("image/") ||
      /\.(png|jpe?g|heic|heif|webp|bmp|gif|tiff?)$/i.test(name)
    ) {
      return await extractFromImageBuffer(buffer, mimeType || "image/png");
    }

    // Plain text / simple exported formats
    if (
      mimeType === "text/plain" ||
      mimeType === "text/html" ||
      mimeType === "application/rtf" ||
      mimeType === "text/rtf" ||
      /\.(txt|rtf|html?)$/i.test(name)
    ) {
      return extractLikelyText(buffer);
    }

    // Last resort: text sniff, then OCR.
    const text = extractLikelyText(buffer);
    if (text.trim().length > MIN_EXTRACTED_CHARS) return text;

    console.log(`Unknown type ${mimeType}, attempting OCR...`);
    try {
      return await extractFromImageBuffer(buffer, "image/png");
    } catch (ocrError) {
      console.error("OCR fallback failed:", ocrError);
    }

    throw new UnreadableDocumentError(
      "We couldn't read text from that file. Try a PDF or Word file, paste the text, or build it with us step by step."
    );
  } catch (error: any) {
    console.error("Text extraction error:", error);
    // Preserve the typed "unreadable" signal so the route can steer the user to
    // the guided builder with a friendly 422 instead of a generic 500.
    if (error instanceof UnreadableDocumentError || error?.code === "UNREADABLE_DOCUMENT") throw error;
    throw new Error(error?.message || "Failed to extract text from file");
  }
}

/**
 * DOM/runtime polyfills so pdfjs text extraction works in the Node/serverless
 * runtime. pdfjs expects browser globals (DOMMatrix, Path2D, ImageData) and
 * Promise.withResolvers -- the last of which is missing on Node < 22 (local dev
 * runs Node 20; Vercel runs 24). Without these, pdfjs throws and every text PDF
 * 500s. See RESUME-PARSER-FIX-2026-08-05.
 */
function ensurePdfjsPolyfills() {
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) { if (Array.isArray(init)) [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
      multiplySelf() { return this; } preMultiplySelf() { return this; }
      translateSelf() { return this; } scaleSelf() { return this; }
      multiply() { return this; } translate() { return this; } scale() { return this; } inverse() { return this; }
    };
  }
  if (typeof g.Path2D === "undefined") g.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} rect() {} };
  if (typeof g.ImageData === "undefined") g.ImageData = class ImageData {
    width: number; height: number; data: Uint8ClampedArray;
    constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray((w || 1) * (h || 1) * 4); }
  };
  if (typeof (Promise as any).withResolvers === "undefined") {
    (Promise as any).withResolvers = function () {
      let resolve: (v: any) => void = () => {};
      let reject: (r?: any) => void = () => {};
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
}

async function extractFromPDF(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new Error("PDF file is empty");
  assertPdfSafe(buffer);
  let out: string;
  if (inThread()) out = await extractFromPDFInThread(buffer);
  else {
    try {
      out = await extractInWorker("pdf", buffer, { budgetMs: PDF_TEXT_BUDGET_MS });
    } catch (e) {
      if (e instanceof ExtractAborted) throw new ReadAbortedError();
      throw e;
    }
  }
  const text = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("PDF contains no extractable text");
  console.log(`PDF: ${text.length} chars`);
  return text;
}

/** The same read in this thread (FORGE_EXTRACT_IN_THREAD=1 only). Keeps pdf.js traced into the build. */
async function extractFromPDFInThread(buffer: Buffer): Promise<string> {
  ensurePdfjsPolyfills();

  // Use pdfjs legacy directly (zero new dep -- pdfjs-dist is already installed).
  // The pdf-parse v2 wrapper runs pdfjs through a path that trips over missing
  // DOM globals in serverless and 500s on every text PDF.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const numPages = doc.numPages;
  let out = "";
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    for (const item of tc.items as any[]) {
      if (!("str" in item)) continue;
      out += item.str + (item.hasEOL ? "\n" : " ");
    }
    out += "\n";
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

async function extractFromPDFWithOCR(buffer: Buffer): Promise<string> {
  // The renderer decodes images and page boxes too: same check, every caller.
  assertPdfSafe(buffer);
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });

    try {
      const rendered = await parser.getScreenshot({
        first: MAX_PDF_OCR_PAGES,
        scale: 2,
        imageBuffer: true,
        imageDataUrl: false,
      });

      const pages = rendered.pages ?? [];
      if (pages.length === 0) throw new Error("PDF rendered no pages for OCR");

      // One OCR budget for the whole document, not one per page.
      const deadline = Date.now() + OCR_TIMEOUT_MS;
      const chunks: string[] = [];
      for (const page of pages) {
        if (!page.data) continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        console.log(`OCR PDF page ${page.pageNumber}/${rendered.total}`);
        const text = await extractFromImageBuffer(Buffer.from(page.data), "image/png", remaining);
        if (text.trim()) chunks.push(text.trim());
      }

      const combined = chunks.join("\n\n");
      if (!combined.trim()) throw new Error("No text detected in scanned PDF");
      return combined;
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    // Rasterizing a scanned/image-only PDF needs a canvas backend that isn't
    // available in the serverless runtime. Fail honestly and let the route steer
    // the user to paste or the guided builder -- never a generic 500.
    console.error("PDF OCR fallback unavailable:", error);
    throw new UnreadableDocumentError(
      "This looks like a scanned or image-only PDF, and we couldn't read the text automatically. Upload a Word or text file, paste the text, or build it with us step by step."
    );
  }
}

async function extractFromDOCX(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new Error("Word document is empty");

  // mammoth never sees the upload: only a new zip of its checked text parts
  // (lib/upload-safety.ts). Throws UnsafeUploadError when the file fails.
  const safe = safeDocxForMammoth(buffer).zip;
  let value: string;
  if (inThread()) {
    const mammoth = await import("mammoth");
    value = (await mammoth.extractRawText({ buffer: safe })).value;
  } else {
    try {
      value = await extractInWorker("docx", safe, { budgetMs: DOCX_TEXT_BUDGET_MS });
    } catch (e) {
      if (e instanceof ExtractAborted) throw new ReadAbortedError();
      throw e;
    }
  }

  if (!value?.trim()) throw new Error("Word document contains no extractable text");

  console.log(`DOCX: ${value.length} chars`);
  return value;
}

async function extractFromImageBuffer(
  buffer: Buffer,
  _mimeType: string,
  timeoutMs: number = OCR_TIMEOUT_MS
): Promise<string> {
  if (buffer.length === 0) throw new Error("Image file is empty");
  if (buffer.length > 50 * 1024 * 1024)
    throw new Error("Image too large (max 50MB)");

  // OCR is intentionally loaded only when needed; most resumes are text PDFs or
  // DOCX files, but phone photos and scanned PDFs must still work.
  let worker: any = null;
  // Set once we stop waiting. A worker that finishes starting after that is
  // terminated on arrival instead of leaking.
  let abandoned = false;
  try {
    const run = async (): Promise<string> => {
      const { createWorker, PSM } = await import("tesseract.js");
      console.log(`Starting OCR (${(buffer.length / 1024).toFixed(1)} KB)...`);

      const w = await createWorker("eng", 1, {
        cachePath: OCR_CACHE_PATH,
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            console.log(`OCR: ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      if (abandoned) {
        await w.terminate();
        throw new OcrTimeoutError(timeoutMs);
      }
      worker = w;

      await w.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: PSM.AUTO,
        user_defined_dpi: "300",
      });

      const { data } = await w.recognize(buffer);
      return data.text ?? "";
    };

    const text = await withOcrTimeout(run(), timeoutMs);
    if (!text.trim()) throw new Error("No text detected in image");
    console.log(`OCR: ${text.length} chars`);
    return text;
  } catch (error) {
    console.error(
      error instanceof OcrTimeoutError ? "OCR timed out:" : "OCR failed:",
      error
    );
    throw new UnreadableDocumentError(
      "We couldn't read text from that image or scan. Try a clearer photo, a PDF/Word file, or paste the text instead."
    );
  } finally {
    abandoned = true;
    if (worker) await worker.terminate().catch(() => {});
  }
}

function hasMeaningfulText(text: string): boolean {
  const alphaNumericChars = text.match(/[A-Za-z0-9]/g)?.length ?? 0;
  return text.trim().length > MIN_EXTRACTED_CHARS && alphaNumericChars >= MIN_MEANINGFUL_CHARS;
}

function extractLikelyText(buffer: Buffer): string {
  const raw = buffer.toString("utf-8").replace(/\u0000/g, "");
  const stripped = raw
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const printable = stripped.match(/[A-Za-z0-9@.,;:'"()/_+\-\s]/g)?.length ?? 0;
  const ratio = stripped.length === 0 ? 0 : printable / stripped.length;
  return ratio > 0.7 ? stripped : "";
}
