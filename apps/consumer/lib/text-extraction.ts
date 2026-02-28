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
 * - Plain text
 * - Unknown formats (OCR as last resort)
 */

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
        if (text.trim().length > 10) return text;
        console.log("PDF text minimal, trying OCR fallback...");
      } catch (error) {
        console.log("PDF extraction failed, falling back to OCR:", error);
      }
      return await extractFromImageBuffer(buffer, "image/png");
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
        if (text.trim().length > 10) return text;
      } catch (error) {
        console.log("DOCX extraction failed:", error);
      }
      // Fallback: try as plain text
      const text = buffer.toString("utf-8");
      if (text.trim().length > 10) return text;
    }

    // Images (OCR)
    if (
      mimeType.startsWith("image/") ||
      /\.(png|jpe?g|heic|heif|webp|bmp|gif|tiff?)$/i.test(name)
    ) {
      return await extractFromImageBuffer(buffer, mimeType || "image/png");
    }

    // Plain text
    if (mimeType === "text/plain" || name.endsWith(".txt")) {
      return buffer.toString("utf-8");
    }

    // Last resort: OCR
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

  const pdfParseModule: any = await import("pdf-parse");
  const pdfParse = pdfParseModule.default ?? pdfParseModule;
  const data = await pdfParse(buffer);

  if (!data.text?.trim()) throw new Error("PDF contains no extractable text");

  console.log(
    `PDF: ${data.text.length} chars, ${data.numpages} pages`
  );
  return data.text;
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

  // tesseract.js is ~35MB and not installed in the consumer app.
  // OCR is a fallback for scanned PDFs/images — rare for this use case.
  try {
    const Tesseract = await import("tesseract.js");
    console.log(`Starting OCR (${(buffer.length / 1024).toFixed(1)} KB)...`);
    const { data } = await Tesseract.recognize(buffer, "eng", {
      logger: (m: any) => {
        if (m.status === "recognizing text") {
          console.log(`OCR: ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    if (!data.text?.trim()) throw new Error("No text detected in image");
    console.log(`OCR: ${data.text.length} chars`);
    return data.text;
  } catch {
    throw new Error(
      "This file looks like a scanned image. Please upload a text-based PDF or Word document instead."
    );
  }
}
