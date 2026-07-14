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

    throw new Error(`Unable to extract text from: ${name}`);
  } catch (error: any) {
    console.error("Text extraction error:", error);
    throw new Error(error.message || "Failed to extract text from file");
  }
}

async function extractFromPDF(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new Error("PDF file is empty");

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  let data: Awaited<ReturnType<typeof parser.getText>>;
  try {
    data = await parser.getText();
  } finally {
    await parser.destroy();
  }

  if (!data.text?.trim()) throw new Error("PDF contains no extractable text");

  console.log(
    `PDF: ${data.text.length} chars, ${data.total} pages`
  );
  return data.text;
}

async function extractFromPDFWithOCR(buffer: Buffer): Promise<string> {
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
    throw new Error(
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
