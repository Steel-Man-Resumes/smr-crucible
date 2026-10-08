/**
 * Security review 3a round 2, H1: the extractors' safety checks
 * (lib/upload-safety.ts), shared by the Forge upload (/api/parse) and the free
 * checker. Every file here is built in the test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, deflateSync, crc32 } from "node:zlib";
import {
  PDF_LOCKED_MESSAGE,
  PDF_MAX_IMAGE_STREAM_BYTES,
  PDF_MAX_STREAMS,
  PDF_MAX_STREAM_BYTES,
  UnsafeUploadError,
  assertSafePdf,
  decodeAscii85,
  findObjectKeywords,
  jpegFrameSize,
  safeDocxForMammoth,
  storedZip,
} from "../upload-safety";
import { extractTextFromBuffer, UnreadableDocumentError } from "../text-extraction";
import * as us from "../upload-safety";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";

/*
 * Real-shaped fixtures from the libraries already in the app (pdf-lib, docx),
 * not the renderer, so this file and lib/upload-safety.ts lift on their own.
 */
const RESUME_LINES = [
  "JORDAN RIVERS",
  "Milwaukee, WI | 414-555-0100 | jordan.rivers@example.com",
  "PROFESSIONAL EXPERIENCE",
  "Warehouse Associate | Acme Logistics | Milwaukee, WI | 2021 - Present",
  "- Pick orders into totes with a handheld RF scanner, then pack them at the pack station.",
  "- Load 40 trucks a day with no safety incidents.",
];

async function realPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonts = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), await doc.embedFont(StandardFonts.TimesRoman)];
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < 40; i++) {
      page.drawText(RESUME_LINES[i % RESUME_LINES.length], { x: 50, y: 740 - i * 17, size: 10, font: fonts[i % fonts.length] });
    }
  }
  return Buffer.from(await doc.save());
}

async function realDocx(): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: RESUME_LINES.map((l) => new Paragraph({ children: [new TextRun(l)] })) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------ builders --- */

/** A one-page PDF with the given content-stream dictionary entries and bytes. */
function pdf(contentDict: string, content: Buffer, opts: { mediabox?: string; pageExtra?: string; extraObjs?: Buffer[]; trailerExtra?: string } = {}): Buffer {
  const objs: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [${opts.mediabox ?? "0 0 612 792"}] /Contents 4 0 R ${opts.pageExtra ?? ""}>>`),
    Buffer.concat([Buffer.from(`<< ${contentDict} /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]),
    ...(opts.extraObjs ?? []),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  let len = parts[0].length;
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(len);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    parts.push(b);
    len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  parts.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${opts.trailerExtra ?? ""}>>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const spaces = (n: number) => Buffer.alloc(n, 0x20);
const refused = (fn: () => unknown, reason: string) =>
  assert.throws(fn, (e: any) => e instanceof UnsafeUploadError && e.reason === reason, reason);
/** Work charged by the last scan (r5); missing on older code, which then fails the bound. */
const scanWork = () => (typeof (us as any).lastPdfScanWork === "function" ? (us as any).lastPdfScanWork() : Infinity);

/** A zip writer that can lie: entry count, duplicates, gaps, mismatched local headers. */
function zip(
  entries: Array<{ name: string; data: Buffer; store?: boolean; localMethod?: number }>,
  opts: { eocdCount?: number; gap?: number } = {}
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const comp = e.store ? e.data : deflateRawSync(e.data);
    const method = e.store ? 0 : 8;
    const name = Buffer.from(e.name);
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.localMethod ?? method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const gap = Buffer.alloc(opts.gap ?? 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = opts.eocdCount ?? entries.length;
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, gap, eocd]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docXml = (text: string) => Buffer.from(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
const CT = Buffer.from(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
);
const RELS = Buffer.from(
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
);
const docx = (doc: Buffer, extra: Array<{ name: string; data: Buffer; store?: boolean }> = []) =>
  zip([{ name: "[Content_Types].xml", data: CT }, { name: "_rels/.rels", data: RELS }, { name: "word/document.xml", data: doc }, ...extra]);

/* --------------------------------------------------------------- PDF ----- */

describe("PDF: checked before any reader opens it", () => {
  it("real-shaped resumes (1 and 2 pages, three fonts) pass and still extract", async () => {
    for (const pages of [1, 2]) {
      const b = await realPdf(pages);
      const scan = assertSafePdf(b);
      assert.ok(scan.streams > 0 && scan.decodedBytes < 2 * 1024 * 1024);
      const out = await extractTextFromBuffer(b, "r.pdf", "application/pdf");
      assert.match(out, /JORDAN RIVERS/);
    }
  });

  it("a stacked filter is refused (the 7 KB double-flate bomb shape)", () => {
    const inner = deflateSync(spaces(32 * 1024 * 1024));
    const outer = deflateSync(inner);
    refused(() => assertSafePdf(pdf("/Filter [/FlateDecode /FlateDecode]", outer)), "pdf_filter");
  });

  it("escaped names cannot hide a chain or the key", () => {
    const z = deflateSync(Buffer.from("BT ET"));
    refused(() => assertSafePdf(pdf("/Filter [/Fl#61teDecode /FlateDecode]", z)), "pdf_filter");
    refused(() => assertSafePdf(pdf("/Filt#65r [/FlateDecode /FlateDecode]", z)), "pdf_filter");
    refused(() => assertSafePdf(pdf("/Filter /FlateDecode /Filter /FlateDecode", z)), "pdf_filter");
    refused(() => assertSafePdf(pdf("/Filter 9 0 R", z)), "pdf_filter");
    refused(() => assertSafePdf(pdf("/Filter /LZWDecode", z)), "pdf_filter");
    refused(() => assertSafePdf(pdf("/Filter /RunLengthDecode", z)), "pdf_filter");
  });

  it("one stream that inflates past the cap is refused (the 1 MB and 708 KB shapes)", () => {
    const t0 = Date.now();
    refused(() => assertSafePdf(pdf("/Filter /FlateDecode", deflateSync(spaces(PDF_MAX_STREAM_BYTES + 1024)))), "pdf_stream_too_big");
    assert.ok(Date.now() - t0 < 3000);
  });

  it("an early 'endstream' inside the data does not hide the bomb after it", () => {
    // A stored deflate block holding the letters "endstream", then the bomb.
    const marker = Buffer.from("xx endstream xx");
    const stored = Buffer.alloc(5);
    stored[0] = 0x00; // not final, stored
    stored.writeUInt16LE(marker.length, 1);
    stored.writeUInt16LE(~marker.length & 0xffff, 3);
    const body = Buffer.concat([Buffer.from([0x78, 0x9c]), stored, marker, deflateRawSync(spaces(PDF_MAX_STREAM_BYTES + 1024))]);
    refused(() => assertSafePdf(pdf("/Filter /FlateDecode", body)), "pdf_stream_too_big");
  });

  it("the one allowed chain (ASCII85 then Flate) is decoded and capped like any other", () => {
    const enc = (b: Buffer) => {
      let out = "";
      for (let i = 0; i < b.length; i += 4) {
        const chunk = Buffer.concat([b.subarray(i, i + 4), Buffer.alloc(4)]).subarray(0, 4);
        let v = chunk.readUInt32BE(0);
        const n = Math.min(4, b.length - i);
        const digits: string[] = [];
        for (let k = 0; k < 5; k++) {
          digits.unshift(String.fromCharCode((v % 85) + 33));
          v = Math.floor(v / 85);
        }
        out += digits.join("").slice(0, n + 1);
      }
      return Buffer.from(out + "~>");
    };
    const small = deflateSync(Buffer.from("BT /F1 12 Tf (Hello) Tj ET"));
    assert.deepEqual(decodeAscii85(enc(small)), small);
    assert.doesNotThrow(() => assertSafePdf(pdf("/Filter [/ASCII85Decode /FlateDecode]", enc(small))));
    refused(() => assertSafePdf(pdf("/Filter [/ASCII85Decode /FlateDecode]", enc(deflateSync(spaces(PDF_MAX_STREAM_BYTES + 1024))))), "pdf_stream_too_big");
    refused(() => assertSafePdf(pdf("/Filter [/FlateDecode /ASCII85Decode]", enc(small))), "pdf_filter");
  });

  it("too many streams, giant pages, giant images and locked files are refused", () => {
    const tiny = Buffer.concat([Buffer.from("<< /Length 1 >>\nstream\nx\nendstream")]);
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { extraObjs: Array(PDF_MAX_STREAMS).fill(tiny) })), "pdf_too_many_streams");
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { mediabox: "0 0 14400 14400" })), "pdf_page_too_big");
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { pageExtra: "/UserUnit 75000 " })), "pdf_page_too_big");
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { mediabox: "0 0 612 792", pageExtra: "/CropBox 9 0 R " })), "pdf_page_too_big");
    const img = Buffer.from("<< /Type /XObject /Subtype /Image /Width 100000 /Height 100000 /BitsPerComponent 8 /Length 1 >>\nstream\nx\nendstream");
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { extraObjs: [img] })), "pdf_image_too_big");
    refused(() => assertSafePdf(pdf("", Buffer.from("q BI /W 100000 /H 100000 /BPC 8 /CS /G ID x EI Q"))), "pdf_image_too_big");
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { trailerExtra: "/Encrypt 9 0 R " })), "pdf_encrypted");
  });

  it("a giant page hidden in an object stream is found", () => {
    const objstm = deflateSync(Buffer.from("7 0 << /Type /Page /MediaBox [0 0 99999 99999] >>"));
    const o = Buffer.concat([Buffer.from(`<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${objstm.length} >>\nstream\n`), objstm, Buffer.from("\nendstream")]);
    refused(() => assertSafePdf(pdf("", Buffer.from("BT ET"), { extraObjs: [o] })), "pdf_page_too_big");
  });

  it("the Forge's upload path refuses these as unreadable, before pdf.js", async () => {
    const bomb = pdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(deflateSync(spaces(1024 * 1024))));
    await assert.rejects(extractTextFromBuffer(bomb, "r.pdf", "application/pdf"), UnreadableDocumentError);
  });
});

/* -------------------------------------------------------------- WORD ----- */

describe("Word: walked, matched, rebuilt; mammoth gets only the rebuilt zip", () => {
  it("a real-shaped Word resume passes and still extracts", async () => {
    const b = await realDocx();
    const r = safeDocxForMammoth(b);
    assert.ok(r.kept.includes("word/document.xml"));
    const out = await extractTextFromBuffer(b, "r.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(out, /JORDAN RIVERS/i);
  });

  it("an under-counted directory with a duplicate document is refused (the r2 dup shape)", () => {
    const bomb = docXml("A".repeat(64 * 1024));
    const b = zip(
      [{ name: "[Content_Types].xml", data: CT }, { name: "_rels/.rels", data: RELS }, { name: "word/document.xml", data: docXml("small") }, { name: "word/document.xml", data: bomb }],
      { eocdCount: 3 }
    );
    assert.throws(() => safeDocxForMammoth(b), (e: any) => e instanceof UnsafeUploadError && (e.reason === "zip_duplicate" || e.reason === "zip_malformed"));
  });

  it("an under-counted directory alone is refused (walked count must match)", () => {
    const b = zip([{ name: "[Content_Types].xml", data: CT }, { name: "word/document.xml", data: docXml("x") }, { name: "word/extra.xml", data: docXml("y") }], { eocdCount: 2 });
    refused(() => safeDocxForMammoth(b), "zip_malformed");
  });

  it("duplicates differing only in case are refused", () => {
    const b = zip([{ name: "word/document.xml", data: docXml("x") }, { name: "WORD/document.xml", data: docXml("y") }]);
    refused(() => safeDocxForMammoth(b), "zip_duplicate");
  });

  it("a gap before the end record (offset shifting) is refused", () => {
    refused(() => safeDocxForMammoth(zip([{ name: "word/document.xml", data: docXml("x") }], { gap: 40 })), "zip_malformed");
  });

  it("a local header that disagrees with the directory is refused", () => {
    refused(() => safeDocxForMammoth(zip([{ name: "word/document.xml", data: docXml("x"), localMethod: 0 }])), "zip_mismatch");
  });

  it("a text part past the cap is refused before mammoth", () => {
    refused(() => safeDocxForMammoth(docx(docXml("A".repeat(9 * 1024 * 1024)))), "zip_too_big");
  });

  it("pictures and other parts are dropped unread; the rebuilt zip is plain stored entries", () => {
    const pic = Buffer.alloc(20 * 1024 * 1024, 1); // 20 MB inside, never inflated
    const r = safeDocxForMammoth(docx(docXml("Line cook"), [{ name: "word/media/image1.png", data: pic }]));
    assert.equal(r.dropped, 1);
    assert.deepEqual(r.kept.sort(), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    assert.ok(r.zip.length < 4096);
    assert.equal(r.zip.readUInt16LE(8), 0, "stored, not compressed");
    assert.deepEqual(safeDocxForMammoth(r.zip).kept.sort(), r.kept.sort(), "the rebuilt zip passes its own check");
  });

  it("the storedZip writer round-trips", () => {
    const z = storedZip([{ name: "word/document.xml", data: docXml("x") }]);
    assert.deepEqual(safeDocxForMammoth(z).kept, ["word/document.xml"]);
  });

  it("the Forge's upload path refuses the bomb instead of reading it as loose text", async () => {
    const b = docx(docXml("A".repeat(9 * 1024 * 1024)));
    await assert.rejects(extractTextFromBuffer(b, "r.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), UnreadableDocumentError);
  });
});

/* ------------------------------------------- hotfix review F1-F6 -------- */

/** An image XObject object for the pdf() builder. */
function imageObj(dict: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]);
}
/** A minimal JPEG header with a frame (SOF0) of the given size. */
function jpegHeader(w: number, h: number): Buffer {
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}
const a85 = (b: Buffer) => {
  let out = "";
  for (let i = 0; i < b.length; i += 4) {
    const n = Math.min(4, b.length - i);
    let v = Buffer.concat([b.subarray(i, i + 4), Buffer.alloc(4)]).readUInt32BE(0);
    const d: string[] = [];
    for (let k = 0; k < 5; k++) {
      d.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    out += d.join("").slice(0, n + 1);
  }
  return Buffer.from(out + "~>");
};

describe("hotfix review: real files main reads stay accepted", () => {
  it("F1: a lossless 2000x2000 colour photo (12 MB decoded) is accepted; an image may not decode past its own size", () => {
    const photo = deflateSync(Buffer.alloc(2000 * 2000 * 3, 0x80));
    const ok = pdf("", Buffer.from("q 100 0 0 100 0 0 cm /Im1 Do Q"), {
      extraObjs: [imageObj("/Width 2000 /Height 2000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", photo)],
    });
    assert.doesNotThrow(() => assertSafePdf(ok));
    // Declares 100x100 (cap stays at the 8 MB floor) but holds 20 MB.
    const liar = pdf("", Buffer.from("BT ET"), {
      extraObjs: [imageObj("/Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", deflateSync(spaces(20 * 1024 * 1024)))],
    });
    refused(() => assertSafePdf(liar), "pdf_stream_too_big");
    // Declares 6000x6000 (under 40 MP, cap at the 48 MB ceiling) and holds more.
    const big = pdf("", Buffer.from("BT ET"), {
      extraObjs: [imageObj("/Width 6000 /Height 6000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", deflateSync(spaces(PDF_MAX_IMAGE_STREAM_BYTES + 1024)))],
    });
    refused(() => assertSafePdf(big), "pdf_stream_too_big");
  });

  it("F2: HTML or RTF saved as .doc, and .rtf labelled msword, are read as text as before", async () => {
    const html = Buffer.from("<html><body><h1>JORDAN RIVERS</h1><p>Warehouse Associate, Acme Logistics, 2021 - Present</p></body></html>");
    const rtf = Buffer.from("{\\rtf1\\ansi JORDAN RIVERS\\par Warehouse Associate, Acme Logistics\\par}");
    for (const [buf, name] of [[html, "resume.doc"], [rtf, "resume.doc"], [rtf, "resume.rtf"]] as const) {
      const out = await extractTextFromBuffer(buf, name, "application/msword");
      assert.match(out, /JORDAN RIVERS/, name);
    }
  });

  it("F3: an image codec after Flate or ASCII85 is accepted; chains that amplify are not", () => {
    const jpeg = Buffer.concat([jpegHeader(600, 800), Buffer.alloc(2000, 7)]);
    const img = (filter: string, data: Buffer) =>
      pdf("", Buffer.from("BT ET"), { extraObjs: [imageObj(`/Width 600 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter}`, data)] });
    assert.doesNotThrow(() => assertSafePdf(img("[/ASCII85Decode /DCTDecode]", a85(jpeg))));
    assert.doesNotThrow(() => assertSafePdf(img("[/FlateDecode /DCTDecode]", deflateSync(jpeg))));
    assert.doesNotThrow(() => assertSafePdf(img("/DCTDecode", jpeg)));
    refused(() => assertSafePdf(img("[/FlateDecode /FlateDecode]", deflateSync(deflateSync(jpeg)))), "pdf_filter");
    refused(() => assertSafePdf(img("[/LZWDecode /DCTDecode]", jpeg)), "pdf_filter");
    refused(() => assertSafePdf(img("[/DCTDecode /FlateDecode]", jpeg)), "pdf_filter");
    // A JPEG frame far past the pixel cap is refused whatever the dictionary claims.
    refused(() => assertSafePdf(img("[/FlateDecode /DCTDecode]", deflateSync(jpegHeader(60000, 60000)))), "pdf_image_too_big");
    assert.deepEqual(jpegFrameSize(jpegHeader(600, 800)), { w: 600, h: 800 });
  });

  it("F4: a copy-protected PDF is refused with words that blame no password", () => {
    assert.throws(
      () => assertSafePdf(pdf("", Buffer.from("BT ET"), { trailerExtra: "/Encrypt 9 0 R " })),
      (e: any) => e instanceof UnsafeUploadError && e.message === PDF_LOCKED_MESSAGE
    );
    assert.doesNotMatch(PDF_LOCKED_MESSAGE, /password/i);
    assert.match(PDF_LOCKED_MESSAGE, /paste the text/);
  });

  it("F5: the main part named in _rels/.rels is accepted under another name", () => {
    const rels = Buffer.from(RELS.toString().replace("word/document.xml", "word/document2.xml"));
    const b = zip([{ name: "[Content_Types].xml", data: CT }, { name: "_rels/.rels", data: rels }, { name: "word/document2.xml", data: docXml("x") }]);
    assert.ok(safeDocxForMammoth(b).kept.includes("word/document2.xml"));
    const missing = zip([{ name: "[Content_Types].xml", data: CT }, { name: "_rels/.rels", data: rels }, { name: "word/document.xml", data: docXml("x") }]);
    refused(() => safeDocxForMammoth(missing), "zip_malformed");
  });

  it("F6: a trailing newline after the zip is accepted; a long tail is not", () => {
    const b = docx(docXml("x"));
    assert.doesNotThrow(() => safeDocxForMammoth(Buffer.concat([b, Buffer.from("\n")])));
    refused(() => safeDocxForMammoth(Buffer.concat([b, Buffer.alloc(2048)])), "zip_malformed");
  });
});

/* ------------------------- security review 3a r3, M1: separators ------- */

/** Minimal PDF text around one object (no xref needed by the scan). */
const mini = (...parts: Array<string | Buffer>) =>
  Buffer.concat([Buffer.from("%PDF-1.7\n"), ...parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)), Buffer.from("\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")]);

describe("r3 M1: object headers and tokens are read with pdf.js's separators", () => {
  const OLD = /(\d+)\s+(\d+)\s+obj\b/;
  it("headers split by NUL, comments, TAB, FF or CR are found (the old \\s regex missed the first two)", () => {
    for (const h of ["5\x000\x00obj", "5%x\n0%y\nobj", "5\t0\fobj", "5\r\n0\r\nobj", "5 %a\r%b\n0 obj", "5\x00%c\n\x000\x00obj"]) {
      const found = findObjectKeywords(h + "<<>>");
      assert.equal(found.length, 1, JSON.stringify(h));
      assert.equal(found[0].at, h.length - 3);
    }
    assert.equal(OLD.test("5\x000\x00obj"), false, "the gap this fixes");
    assert.equal(OLD.test("5%x\n0%y\nobj"), false, "the gap this fixes");
    assert.deepEqual(findObjectKeywords("1 0 endobj"), []);
    assert.deepEqual(findObjectKeywords("5 0 objx"), []);
    assert.deepEqual(findObjectKeywords("/obj<<>>"), []);
    assert.equal(findObjectKeywords("(a%b) 5 0 %c\nobj<<>>")[0].at, "(a%b) 5 0 %c\n".length);
  });

  it("a stream behind such a header is seen (chain refused) and capped (over the cap refused)", () => {
    const z = deflateSync(Buffer.from("BT ET"));
    refused(() => assertSafePdf(mini("5\x000\x00obj<</Filter[/FlateDecode/FlateDecode]>>stream\n", z)), "pdf_filter");
    refused(() => assertSafePdf(mini("5%x\n0%y\nobj<</Filter[/FlateDecode/FlateDecode]>>stream\n", z)), "pdf_filter");
    refused(() => assertSafePdf(mini("5%x\n0\x00obj<</Filter/FlateDecode>>stream\n", deflateSync(spaces(PDF_MAX_STREAM_BYTES + 1024)))), "pdf_stream_too_big");
  });

  it("dictionary tokens take the same separators: Filter, Width, Height, MediaBox, UserUnit, Encrypt", () => {
    const z = deflateSync(Buffer.from("BT ET"));
    refused(() => assertSafePdf(mini("5 0 obj<<\x00/Filter\x00[/FlateDecode\x00/FlateDecode]>>stream\n", z)), "pdf_filter");
    refused(() => assertSafePdf(mini("5 0 obj<</Filter%c\n[/FlateDecode%c\n/FlateDecode]>>stream\n", z)), "pdf_filter");
    refused(() => assertSafePdf(mini("5 0 obj<</Subtype/Image/Width%c\n100000/Height\x00100000>>stream\n", "x")), "pdf_image_too_big");
    refused(() => assertSafePdf(mini("5 0 obj<</Type/Page/MediaBox\x00[0\x000\x0099999\x0099999]>>stream\n", "x")), "pdf_page_too_big");
    refused(() => assertSafePdf(mini("5 0 obj<</Type/Page/UserUnit%c\n75000>>stream\n", "x")), "pdf_page_too_big");
    refused(() => assertSafePdf(Buffer.from("%PDF-1.7\ntrailer\x00<<\x00/Encrypt\x009 0 R>>\n%%EOF\n", "latin1")), "pdf_encrypted");
    refused(() => assertSafePdf(Buffer.from("%PDF-1.7\ntrailer%c\n<</Encr#79pt 9 0 R>>\n%%EOF\n", "latin1")), "pdf_encrypted");
  });

  it("pdf.js's short keys count: /F for the filter, /W and /H for an image's size", () => {
    const z = deflateSync(Buffer.from("BT ET"));
    refused(() => assertSafePdf(mini("5 0 obj<</F[/FlateDecode/FlateDecode]>>stream\n", z)), "pdf_filter");
    refused(() => assertSafePdf(mini("5 0 obj<</Subtype/Image/W 100000/H 100000>>stream\n", "x")), "pdf_image_too_big");
  });

  it("stream and endstream: a comment before 'stream', bytes before its end of line, and a lying /Length change nothing", () => {
    const big = deflateSync(spaces(PDF_MAX_STREAM_BYTES + 1024));
    refused(() => assertSafePdf(mini("5 0 obj<</Filter/FlateDecode>>%c\nstream\n", big)), "pdf_stream_too_big");
    refused(() => assertSafePdf(mini("5 0 obj<</Filter/FlateDecode>>stream junk\r\n", big)), "pdf_stream_too_big");
    refused(() => assertSafePdf(mini("5 0 obj<</Filter/FlateDecode/Length\x001>>stream\n", big)), "pdf_stream_too_big");
    // An unfiltered content stream behind a NUL header still has its inline images checked.
    refused(() => assertSafePdf(mini("5\x000\x00obj<<>>stream\nq BI /W 100000 /H 100000 /BPC 8 /CS /G ID x EI Q")), "pdf_image_too_big");
  });
});

/* ------------------------------- security review 3a r4 ----------------- */

describe("r4: linear object finding, lenient numbers, hidden streams, text codecs, short keys", () => {
  const z = deflateSync(Buffer.from("BT ET"));

  it("M2: headers whose numbers pdf.js reads leniently are found (the numbers are not read at all)", () => {
    for (const h of ["+5 0 obj", "5.0 0 obj", "05 00 obj", "5 0obj", "-0 0 obj", "5\x000\x00obj"]) {
      assert.equal(findObjectKeywords(h + "<<>>").length, 1, JSON.stringify(h));
      refused(() => assertSafePdf(mini(`${h}<</Filter[/FlateDecode/FlateDecode]>>stream\n`, z)), "pdf_filter");
    }
  });

  it("M3: a stream inside an object stream is refused", () => {
    const inner = deflateSync(Buffer.from("7 0 <</Filter/FlateDecode/Length 5>>stream\nxxxxx\nendstream"));
    refused(() => assertSafePdf(mini(`5 0 obj<</Type/ObjStm/N 1/First 4/Filter/FlateDecode>>stream\n`, inner)), "pdf_hidden_stream");
    const fine = deflateSync(Buffer.from("7 0 <</Type/Page/MediaBox[0 0 612 792]>>"));
    assert.doesNotThrow(() => assertSafePdf(mini(`5 0 obj<</Type/ObjStm/N 1/First 4/Filter/FlateDecode>>stream\n`, fine)));
  });

  it("L2: a stream whose only filter is ASCIIHex or ASCII85 is decoded and checked", () => {
    const hex = Buffer.from("q BI /W 100000 /H 100000 /BPC 8 /CS /G ID x EI Q").toString("hex") + ">";
    refused(() => assertSafePdf(mini("5 0 obj<</Filter/ASCIIHexDecode>>stream\n", hex)), "pdf_image_too_big");
    const page = a85(Buffer.from("7 0 <</Type/Page/MediaBox[0 0 99999 99999]>>"));
    refused(() => assertSafePdf(mini("5 0 obj<</Type/ObjStm/N 1/First 4/Filter/ASCII85Decode>>stream\n", page)), "pdf_page_too_big");
  });

  it("L1: the short size keys win when both are present, as in pdf.js", () => {
    refused(() => assertSafePdf(mini("5 0 obj<</Subtype/Image/W 100000/Width 100/H 100000/Height 100>>stream\n", "x")), "pdf_image_too_big");
    assert.doesNotThrow(() => assertSafePdf(mini("5 0 obj<</Subtype/Image/Width 100000/W 100/Height 100000/H 100>>stream\n", "x")));
    refused(() => assertSafePdf(mini("5 0 obj<<>>stream\nq BI /W 100000 /Width 10 /H 100000 /Height 10 /BPC 8 /CS /G ID x EI Q")), "pdf_image_too_big");
  });

  it("M1: 1 MB benign runs: work at most 12 units a byte plus a base (no quadratic shape); wall clock only a 2 s sanity cap", () => {
    const MB = 1024 * 1024;
    const runs: Record<string, string> = {
      digits: "1".repeat(MB),
      "1 %": "1 %".repeat(MB / 3),
      "1 1 %": "1 1 %".repeat(MB / 5),
      "obj without delimiters": "obj".repeat(MB / 3),
      "whitespace and comments": " \x00\t %c\n".repeat(MB / 8),
      "obj then comment": "obj %".repeat(MB / 5),
      "digits then letter": "1".repeat(MB) + "x",
    };
    for (const [name, text] of Object.entries(runs)) {
      const b = Buffer.from("%PDF-1.7\n" + text, "latin1");
      // r5: the instrumented work count is the bound (wall clock is flaky on a
      // busy machine); the clock stays only as a generous sanity cap.
      const t0 = performance.now();
      try {
        assertSafePdf(b);
      } catch (e) {
        assert.ok(e instanceof UnsafeUploadError, name);
      }
      const ms = performance.now() - t0;
      assert.ok(scanWork() <= 12 * b.length + 2 * 1024 * 1024, `${name}: ${(scanWork() / b.length).toFixed(2)} units a byte`);
      assert.ok(ms < 2000, `${name}: ${ms.toFixed(1)} ms`);
    }
  });

  it("a shape that makes many candidates re-read one long run is refused, quickly", () => {
    // "obj<</A(" opens a string at every candidate; one closing run at the end.
    // r5: an object starting inside one already read is malformed (was: the work budget).
    const n = 20000;
    const text = "obj<</A(".repeat(n) + ")".repeat(n) + ">>";
    const t0 = performance.now();
    assert.throws(() => assertSafePdf(Buffer.from(text, "latin1")), (e: any) => e instanceof UnsafeUploadError && e.reason === "pdf_malformed");
    assert.ok(performance.now() - t0 < 2000);
    assert.ok(scanWork() <= 12 * text.length + 2 * 1024 * 1024);
  });
});

/* ------------------------------- security review 3a r5 ----------------- */

/** pdf.js 5.4.296's Ascii85Stream.readBlock, transcribed (an independent reference). */
function pdfjsAscii85(src: Buffer): Buffer {
  const out: number[] = [];
  const ws = (c: number) => c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a;
  let p = 0;
  const get = () => (p < src.length ? src[p++] : -1);
  for (;;) {
    let c = get();
    while (ws(c)) c = get();
    if (c === -1 || c === 0x7e) break;
    if (c === 0x7a) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const input = [c, 0, 0, 0, 0];
    let i: number;
    for (i = 1; i < 5; ++i) {
      c = get();
      while (ws(c)) c = get();
      input[i] = c;
      if (c === -1 || c === 0x7e) break;
    }
    const n = i - 1;
    let eof = false;
    if (i < 5) {
      for (; i < 5; ++i) input[i] = 0x21 + 84;
      eof = true;
    }
    let t = 0;
    for (i = 0; i < 5; ++i) t = t * 85 + (input[i] - 0x21);
    const four = [0, 0, 0, 0];
    for (i = 3; i >= 0; --i) {
      four[i] = t & 0xff;
      t >>= 8;
    }
    out.push(...four.slice(0, n));
    if (eof) break;
  }
  return Buffer.from(out);
}

const wrapStream = (dict: string, data = "hello") => mini(`1 0 obj\n${dict}\nstream\n${data}`);
const objstmFile = (dict: string, body: string) => mini(`2 0 obj\n<< /Type /ObjStm ${dict} >>\nstream\n${body}`);
const best = (fn: () => unknown, runs = 3) => {
  let ms = Infinity;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    try {
      fn();
    } catch (e) {
      if (!(e instanceof UnsafeUploadError)) throw e;
    }
    ms = Math.min(ms, performance.now() - t0);
  }
  return ms;
};

describe("r5 H1: objects are read with pdf.js's grammar, and anything malformed is refused", () => {
  const z = deflateSync(Buffer.from("BT ET"));

  it("the reviewer's four malformed dictionaries are refused, at top level, for page boxes and in object streams", () => {
    for (const d of [
      "<< /A >> /Filter /LZWDecode >>", // a key with no value
      "<< << /Filter /LZWDecode >>", // "<<" where a key belongs
      "<< /A << /B [ >> ] >> /Filter /LZWDecode >>", // ">>" inside an array
      "<< /A [ << ] >> ] /Filter /LZWDecode >>", // "]" inside a dictionary
    ]) {
      refused(() => assertSafePdf(wrapStream(d)), "pdf_malformed");
    }
    refused(() => assertSafePdf(mini("1 0 obj\n<< /Type /Page /A >> /MediaBox [0 0 99999 99999] >>\nendobj\nstream\n")), "pdf_malformed");
    refused(() => assertSafePdf(objstmFile("/N 1 /First 4", "5 0 << /A >> /B 1 >> stream\nx\n")), "pdf_malformed");
    refused(() => assertSafePdf(objstmFile("/N 1 /First 4", "5 0 << /A [ << ] >> ] >> stream\nx\n")), "pdf_malformed");
    // The well-formed shapes still pass, and the refused filter is still seen.
    assert.doesNotThrow(() => assertSafePdf(wrapStream("<< /A 1 /B [ << /C (x) >> 2 0 R ] /D << /E [ /F ] >> /Length 5 >>")));
    refused(() => assertSafePdf(wrapStream("<< /A 1 /B [ << /C (x) >> ] /Filter /LZWDecode >>")), "pdf_filter");
  });

  it("other malformed shapes are refused: non-name keys, command words as values, unclosed strings, arrays and dictionaries, deep nesting", () => {
    for (const d of [
      "<< 5 /Filter /FlateDecode >>",
      "<< /A obj /Filter /FlateDecode >>",
      "<< /A (unclosed /Filter /FlateDecode >>",
      "<< /A [ 1 2 /Filter /FlateDecode >>",
      "<< /A <414243 /Filter /FlateDecode >>",
      "<< /A ] /Filter /FlateDecode >>",
      "<< /A " + "[".repeat(100) + "]".repeat(100) + " >>",
    ]) {
      refused(() => assertSafePdf(wrapStream(d)), "pdf_malformed");
    }
    refused(() => assertSafePdf(Buffer.from("%PDF-1.7\n1 0 obj\n<< /A 1 ", "latin1")), "pdf_malformed");
    // true, false, null, references and numbers pdf.js reads leniently are values.
    assert.doesNotThrow(() => assertSafePdf(wrapStream("<< /A true /B false /C null /D 1 0 R /E -.5 /G 1e-5 /H +3 >>")));
  });

  it("a stream after a dictionary nested in another object is refused (pdf.js would read it)", () => {
    refused(() => assertSafePdf(mini("1 0 obj\n[ << /Filter /LZWDecode >> stream\nhello")), "pdf_hidden_stream");
    refused(() => assertSafePdf(mini("1 0 obj\n<< /A << /Filter /LZWDecode >> stream\nhello")), "pdf_hidden_stream");
  });

  it("the final sweep: a 'stream' keyword the scan did not check is refused; one inside checked data is fine", () => {
    refused(() => assertSafePdf(mini("1 0 obj\n[ 1 2 ]\nstream\nhello")), "pdf_malformed");
    refused(() => assertSafePdf(mini("1 0 obj\n(x) stream\nhello")), "pdf_malformed");
    assert.doesNotThrow(() => assertSafePdf(wrapStream("<< /Length 30 >>", "BT (a stream of words) Tj ET")));
  });

  it("objects never overlap: one inside another, or a stream inside another stream's data, is refused", () => {
    refused(() => assertSafePdf(mini("1 0 obj << /T (2 0 obj << /Filter /LZWDecode >>) >>\nstream\nx")), "pdf_malformed");
    refused(() => assertSafePdf(mini("1 0 obj <<>> stream\nxx 2 0 obj << /Filter /LZWDecode >> stream\nhello")), "pdf_malformed");
  });

  it("end to end: a page whose content dictionary is malformed never reaches pdf.js", async () => {
    const b = pdf("/A >> /Filter /FlateDecode", z);
    refused(() => assertSafePdf(b), "pdf_malformed");
    await assert.rejects(extractTextFromBuffer(b, "r.pdf", "application/pdf"), UnreadableDocumentError);
  });

  it("object streams: header and offsets read as pdf.js reads them; anything else refused", () => {
    assert.doesNotThrow(() => assertSafePdf(objstmFile("/N 2 /First 8", "5 0 6 12 << /A 1 >> [ 1 2 ]")));
    refused(() => assertSafePdf(objstmFile("/N 2 /First 8", "5 0 6 x  << /A 1 >> [ 1 2 ]")), "pdf_malformed"); // not a number
    refused(() => assertSafePdf(objstmFile("/N 2 /First 8", "5 9 6 0  << /A 1 >> [ 1 2 ]")), "pdf_malformed"); // offsets go back
    refused(() => assertSafePdf(objstmFile("/N 3 0 R /First 8", "5 0 6 12 << /A 1 >> [ 1 2 ]")), "pdf_malformed"); // indirect /N
    refused(() => assertSafePdf(objstmFile("/N 1 /First 4", "5 0 [ << /B 1 >> stream\nx ]")), "pdf_hidden_stream");
  });

  it("inline images in content are read from the content's start: a malformed one is refused, text that spells BI is not", () => {
    const ok = (c: string) => assert.doesNotThrow(() => assertSafePdf(pdf("", Buffer.from(c, "latin1"))), c);
    ok("q BI /W 10 /H 10 /BPC 8 /CS /G /D [0 1] /DP << /K -1 >> ID xxxxxxxxxx EI Q");
    ok("BT /F1 12 Tf (BI Developer, Acme) Tj ET");
    // The backup check reads every "BI", strings included, so text spelling a giant image is refused (as before r5).
    refused(() => assertSafePdf(pdf("", Buffer.from("BT (BI /W 99999 /H 99999) Tj ET"))), "pdf_image_too_big");
    refused(() => assertSafePdf(pdf("", Buffer.from("q BI 5 /W 10 ID x EI Q"))), "pdf_malformed");
    refused(() => assertSafePdf(pdf("", Buffer.from("q BI /W 10 /H 10 ID xxxx"))), "pdf_malformed"); // no EI
    refused(() => assertSafePdf(pdf("", Buffer.from("q BI /W 9 0 R /H 10 ID x EI Q"))), "pdf_image_too_big"); // size by reference
    // In a stream typed as binary (a font), random bytes spelling BI are not refused, but sizes are still checked.
    const font = (bytes: string) => pdf("/Length1 9", Buffer.from(bytes, "latin1"));
    assert.doesNotThrow(() => assertSafePdf(font("\x01\x02 BI 5 ) ] >> garbage")));
    refused(() => assertSafePdf(font("\x01 BI /X ] /W 99999 /H 99999 ID x EI")), "pdf_image_too_big");
  });
});

describe("r5 M3: text codecs decode into bounded buffers, the way pdf.js decodes them", () => {
  it("ASCII85 matches pdf.js on every byte class (z, digits out of range, NUL and FF as digits, partial groups)", () => {
    const vectors = ["87cURD]i,\"Ebo80~>", "zz!!~>", "{{{{{~>", "\x00\x00\x00\x00\x00~>", "ab\x0ccd e~>", "a~>", "ab~>", "abcd", "z!!!", "5sdq,77I~>"];
    for (const v of vectors) {
      const b = Buffer.from(v, "latin1");
      assert.deepEqual(decodeAscii85(b), pdfjsAscii85(b), JSON.stringify(v));
    }
  });

  it("output past the limit is refused while decoding, before anything that size is built", () => {
    const zs = Buffer.alloc(3 * 1024 * 1024, 0x7a); // 12 MB of zeros once decoded
    const before = process.memoryUsage().arrayBuffers;
    assert.throws(() => decodeAscii85(zs, PDF_MAX_STREAM_BYTES), (e: any) => e instanceof UnsafeUploadError && e.reason === "pdf_stream_too_big");
    assert.ok(process.memoryUsage().arrayBuffers - before < 4 * 1024 * 1024, "no full-size buffer was made");
    refused(() => assertSafePdf(wrapStream("<< /Filter /ASCII85Decode >>", "z".repeat(3 * 1024 * 1024) + "~>")), "pdf_stream_too_big");
    refused(() => assertSafePdf(wrapStream("<< /Filter [/ASCII85Decode /FlateDecode] >>", "z".repeat(3 * 1024 * 1024) + "~>")), "pdf_stream_too_big");
  });

  it("a text codec's end mark must be in its own stream's data", () => {
    refused(() => assertSafePdf(wrapStream("<< /Filter /ASCII85Decode >>", "zzzz")), "pdf_malformed");
    refused(() => assertSafePdf(wrapStream("<< /Filter /ASCIIHexDecode >>", "414243")), "pdf_malformed");
    assert.doesNotThrow(() => assertSafePdf(wrapStream("<< /Filter /ASCIIHexDecode >>", "414243>")));
  });
});

describe("r5 M1, M2: one cursor, every byte charged, work linear in the file", () => {
  const MB = 1024 * 1024;
  const rep = (u: string, n: number) => u.repeat(Math.max(1, Math.floor(n / u.length)));
  const shapes = (n: number): Record<string, string> => ({
    "plain digits": rep("1", n),
    "plain spaces": rep(" ", n),
    "comment lines": rep("% a comment line\n", n),
    "comment lines containing obj": rep("%obj\n", n),
    "%obj run, one line": rep("%obj ", n),
    "obj then comment": rep("obj %", n),
    "obj then space": rep("obj ", n),
    "1 0 obj repeated": rep("1 0 obj ", n),
    "comment lines ending obj <<": rep("%" + "x".repeat(64) + " obj <<\n", n),
    "5000 empty unfiltered streams, then spaces": rep("1 0 obj<<>>stream\n", 5000 * 18) + rep(" ", n - 5000 * 18),
    "5000 closed empty streams, then spaces": rep("1 0 obj<<>>stream\nendstream\nendobj\n", 5000 * 35) + rep(" ", n - 5000 * 35),
    "obj<< repeated": rep("obj<<", n),
    "unclosed dictionaries": rep("obj << /A ", n),
    "nested strings": rep("obj<</A(", n / 2) + ">>",
    "endstream repeated": rep("endstream ", n),
    "content: text operators": "1 0 obj <<>> stream\n" + rep("BT /F1 12 Tf (Hello) Tj ET\n", n) + "\nendstream\n",
    "content: (BI runs": "1 0 obj <<>> stream\n" + rep("(BI ", n) + "\nendstream\n",
  });

  it("total work is at most 12 units a byte plus a fixed base, at 1 MB and at 10 MB, for every shape", () => {
    for (const n of [MB, 10 * MB]) {
      for (const [name, text] of Object.entries(shapes(n))) {
        const b = Buffer.from("%PDF-1.7\n" + text, "latin1");
        try {
          assertSafePdf(b);
        } catch (e) {
          assert.ok(e instanceof UnsafeUploadError, name);
        }
        const w = scanWork();
        assert.ok(w <= 12 * b.length + 2 * MB, `${name} at ${n / MB} MB: ${(w / b.length).toFixed(2)} units a byte`);
      }
    }
  });

  it("wall clock, as a sanity cap only: every shape finishes (or is refused) in under 2 s at 1 MB", () => {
    for (const [name, text] of Object.entries(shapes(MB))) {
      const b = Buffer.from("%PDF-1.7\n" + text, "latin1");
      const ms = best(() => assertSafePdf(b), 1);
      assert.ok(ms < 2000, `${name}: ${ms.toFixed(1)} ms`);
    }
  });

  it("the r5 slow shapes at 200 KB: linear work, and well under the 2 s cap (they took 11 s and 0.7 s before)", () => {
    const b1 = Buffer.from("%PDF-1.7\n" + "%obj\n".repeat(40000), "latin1");
    const b2 = Buffer.from("%PDF-1.7\n" + "1 0 obj<<>>stream\n".repeat(5000) + " ".repeat(110000), "latin1");
    for (const b of [b1, b2]) {
      const ms = best(() => assertSafePdf(b), 1);
      assert.ok(scanWork() <= 12 * b.length + 2 * 1024 * 1024);
      assert.ok(ms < 2000, `${ms.toFixed(1)} ms`);
    }
  });
});
