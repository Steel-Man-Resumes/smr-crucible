/**
 * Security review 3a round 2, H1 (c): pdf.js and mammoth run in a worker with
 * a heap limit, and the time budget terminates the worker (a Promise.race
 * only stopped waiting).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { ExtractAborted, extractInWorker } from "../extract-worker";
import { storedZip } from "../upload-safety";
import { extractTextFromBuffer, extractTextForCheck } from "../text-extraction";

const root = join(import.meta.dirname, "..", "..");

async function pdfWith(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 740 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

describe("the extraction worker", () => {
  it("reads a PDF and a Word file in the worker", async () => {
    const pdf = await pdfWith(["JORDAN RIVERS", "Warehouse Associate | Acme Logistics | 2021 - Present"]);
    assert.match(await extractInWorker("pdf", pdf, { budgetMs: 20_000 }), /JORDAN RIVERS/);
    const docx = Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("MORGAN SAMPLE line cook")] })] }] })));
    assert.match(await extractTextFromBuffer(docx, "r.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), /MORGAN SAMPLE/);
  });

  it("the budget terminates the worker and rejects", async () => {
    const pdf = await pdfWith(["JORDAN RIVERS"]);
    const t0 = Date.now();
    await assert.rejects(extractInWorker("pdf", pdf, { budgetMs: 1 }), (e: any) => e instanceof ExtractAborted && e.why === "time");
    assert.ok(Date.now() - t0 < 2000);
  });

  it("past its heap limit the worker dies, the process does not", async () => {
    const pdf = await pdfWith(["JORDAN RIVERS"]);
    // A Word file the size checks allow (6 MB of text) read with the smallest heap.
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const para = "<w:p><w:r><w:t>" + "A".repeat(200) + "</w:t></w:r></w:p>";
    const xml = `<?xml version="1.0"?><w:document ${W}><w:body>${para.repeat(30_000)}</w:body></w:document>`;
    const big = storedZip([{ name: "word/document.xml", data: Buffer.from(xml) }]);
    await assert.rejects(extractInWorker("docx", big, { budgetMs: 60_000, heapMb: 32 }), (e: any) => e instanceof ExtractAborted && e.why === "memory");
    // Still alive and still working afterwards:
    assert.match(await extractInWorker("pdf", pdf, { budgetMs: 20_000 }), /JORDAN RIVERS/);
  });

  it("the page cap is enforced inside the worker", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 12; i++) doc.addPage([612, 792]).drawText("x", { x: 50, y: 700 });
    await assert.rejects(extractTextForCheck(Buffer.from(await doc.save())), /more pages than a resume/);
  });

  it("text-extraction reads pdf.js and mammoth through the worker; next.config keeps both external", () => {
    const te = readFileSync(join(root, "lib/text-extraction.ts"), "utf8");
    assert.match(te, /extractInWorker\("pdf", buffer/);
    assert.match(te, /extractInWorker\("docx", safe/);
    assert.match(te, /if \(error instanceof ReadAbortedError\) throw error;/);
    const cfg = readFileSync(join(root, "next.config.mjs"), "utf8");
    assert.match(cfg, /serverExternalPackages: \["pdfjs-dist", "tesseract.js", "mammoth"\]/);
  });
});
