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

const MIN_EXTRACTED_CHARS = 10;
const MIN_MEANINGFUL_CHARS = 20;
const MAX_PDF_OCR_PAGES = 5;
const OCR_CACHE_PATH = "/tmp/tesseract-cache";

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

export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const name = fileName.toLowerCase();

  console.log(`Extracting text from: ${name} (${mimeType})`);

  try {
    // PDF
    if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
      try {
        const text = await extractFromPDF(buffer);
        if (hasMeaningfulText(text)) return text;
        console.log("PDF text minimal, trying OCR fallback...");
      } catch (error) {
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
      try {
        const text = await extractFromDOCX(buffer);
        if (text.trim().length > MIN_EXTRACTED_CHARS) return text;
      } catch (error) {
        console.log("DOCX extraction failed:", error);
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

  const text = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("PDF contains no extractable text");

  console.log(`PDF: ${text.length} chars, ${numPages} pages`);
  return text;
}

async function extractFromPDFWithOCR(buffer: Buffer): Promise<string> {
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

      const chunks: string[] = [];
      for (const page of pages) {
        if (!page.data) continue;
        console.log(`OCR PDF page ${page.pageNumber}/${rendered.total}`);
        const text = await extractFromImageBuffer(Buffer.from(page.data), "image/png");
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

  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    buffer,
  });

  if (!result.value?.trim())
    throw new Error("Word document contains no extractable text");

  console.log(`DOCX: ${result.value.length} chars`);
  return result.value;
}

async function extractFromImageBuffer(
  buffer: Buffer,
  _mimeType: string
): Promise<string> {
  if (buffer.length === 0) throw new Error("Image file is empty");
  if (buffer.length > 50 * 1024 * 1024)
    throw new Error("Image too large (max 50MB)");

  // OCR is intentionally loaded only when needed; most resumes are text PDFs or
  // DOCX files, but phone photos and scanned PDFs must still work.
  let worker: any = null;
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    console.log(`Starting OCR (${(buffer.length / 1024).toFixed(1)} KB)...`);

    worker = await createWorker("eng", 1, {
      cachePath: OCR_CACHE_PATH,
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          console.log(`OCR: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: "300",
    });

    const { data } = await worker.recognize(buffer);
    if (!data.text?.trim()) throw new Error("No text detected in image");
    console.log(`OCR: ${data.text.length} chars`);
    return data.text;
  } catch (error) {
    console.error("OCR failed:", error);
    throw new UnreadableDocumentError(
      "We couldn't read text from that image or scan. Try a clearer photo, a PDF/Word file, or paste the text instead."
    );
  } finally {
    if (worker) await worker.terminate();
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
