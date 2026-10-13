/**
 * Hotfix (upload bombs): a file the upload safety check refuses reaches
 * /api/parse as the existing "unreadable" error, so the route answers its
 * plain 422 ("Paste the text, or use our guided builder"), never a 500.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, deflateSync, crc32 } from "node:zlib";
import { extractTextFromBuffer } from "../text-extraction";

const root = join(import.meta.dirname, "..", "..");

function onePagePdf(contentDict: string, content: Buffer): Buffer {
  const head = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n" +
      `4 0 obj\n<< ${contentDict} /Length ${content.length} >>\nstream\n`
  );
  return Buffer.concat([head, content, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")]);
}

function oneEntryDocx(xml: Buffer): Buffer {
  const name = Buffer.from("word/document.xml");
  const comp = deflateRawSync(xml);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc32(xml), 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(xml.length, 22);
  lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc32(xml), 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(xml.length, 24);
  ch.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length + comp.length, 16);
  return Buffer.concat([lh, name, comp, ch, name, end]);
}

describe("/api/parse: a refused upload is the plain unreadable error", () => {
  it("PDF and Word bombs throw with code UNREADABLE_DOCUMENT", async () => {
    const pdfBomb = onePagePdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(deflateSync(Buffer.alloc(1024 * 1024, 32))));
    const docxBomb = oneEntryDocx(Buffer.from("<w:document>" + "A".repeat(9 * 1024 * 1024) + "</w:document>"));
    for (const [buf, name, mime] of [
      [pdfBomb, "r.pdf", "application/pdf"],
      [docxBomb, "r.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ] as const) {
      await assert.rejects(extractTextFromBuffer(buf, name, mime), (e: any) => e?.code === "UNREADABLE_DOCUMENT", name);
    }
  });

  it("the route turns that code into its 422 with the guided-builder flag", () => {
    const src = readFileSync(join(root, "app/api/parse/route.ts"), "utf8");
    assert.match(src, /if \(error\?\.code === "UNREADABLE_DOCUMENT"\) \{/);
    const block = src.slice(src.indexOf('if (error?.code === "UNREADABLE_DOCUMENT")'));
    assert.match(block.slice(0, 400), /guided: true/);
    assert.match(block.slice(0, 400), /status: 422/);
  });

  it("a PDF over 10 MB is refused before it is read (r5: pdf.js memory sits outside the worker's heap limit)", () => {
    const src = readFileSync(join(root, "app/api/parse/route.ts"), "utf8");
    assert.match(src, /const PDF_MAX_UPLOAD_BYTES = 10 \* 1024 \* 1024;/);
    const cap = src.indexOf("isPdf && file.size > PDF_MAX_UPLOAD_BYTES");
    assert.ok(cap > 0 && cap < src.indexOf("await file.arrayBuffer()"), "checked before the file is read");
    assert.match(src.slice(cap, cap + 300), /status: 413/);
  });
});
