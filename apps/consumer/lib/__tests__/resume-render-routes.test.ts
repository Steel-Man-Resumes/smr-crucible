/**
 * The download and layout handlers, called directly (no rate limiter, no
 * server): formats, the zip package, DRAFT pass-through, safety limits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import { handleDownloadPost } from "../forge-download-handler";
import { handleLayoutPost } from "../resume-layout-handler";
import { nameFromResumeText } from "../resume-download";
import { COVER_LETTER, ONE_PAGE, TWO_PAGE } from "./fixtures/render-resumes";

function post(handler: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) {
  return handler(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nlen + elen + clen;
  }
  return out;
}

test("download: pdf comes back as a real PDF with the right headers", async () => {
  const res = await post(handleDownloadPost, { content: TWO_PAGE, type: "resume", format: "pdf", firstName: "Morgan", lastName: "Casey" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition") || "", /filename="Morgan-Casey\.pdf"/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

test("download: docx is still the default and html is a self-contained page", async () => {
  const docx = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume" });
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get("content-type") || "", /wordprocessingml/);
  assert.match(docx.headers.get("content-disposition") || "", /\.docx"/);
  const html = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume", format: "html" });
  assert.match(html.headers.get("content-type") || "", /text\/html/);
  assert.match(await html.text(), /<section class="page/);
});

test("download: the zip holds the resume PDF and Word, plus the cover letter in Word", async () => {
  const res = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume", format: "zip", coverLetter: COVER_LETTER, name: "Jordan Rivers" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  const files = unzip(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual([...files.keys()].sort(), ["Jordan-Rivers-CoverLetter.docx", "Jordan-Rivers.docx", "Jordan-Rivers.pdf"]);
  assert.equal(files.get("Jordan-Rivers.pdf")!.subarray(0, 5).toString(), "%PDF-");
  assert.equal(files.get("Jordan-Rivers.docx")!.subarray(0, 2).toString(), "PK");
  assert.equal(files.get("Jordan-Rivers-CoverLetter.docx")!.subarray(0, 2).toString(), "PK");
});

test("download: the zip without a cover letter holds two files", async () => {
  const res = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume", format: "zip" });
  assert.equal(unzip(Buffer.from(await res.arrayBuffer())).size, 2);
});

test("download: draft and open items pass through, so the PDF carries a to-do page", async () => {
  const res = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume", format: "pdf", draft: true, openItems: ["Check the phone number."] });
  assert.equal((await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount(), 2, "one resume page plus the to-do page");
  const fin = await post(handleDownloadPost, { content: ONE_PAGE, type: "resume", format: "pdf", draft: false, openItems: ["Check the phone number."] });
  assert.equal((await PDFDocument.load(new Uint8Array(await fin.arrayBuffer()))).getPageCount(), 1, "finished: no to-do page");
  const txt = await post(handleDownloadPost, { content: "Hello", type: "resume", format: "txt", draft: true });
  assert.match(await txt.text(), /^DRAFT\n\nHello$/);
});

test("download: the existing safety limits still hold", async () => {
  assert.equal((await post(handleDownloadPost, { type: "resume" })).status, 400);
  assert.equal((await post(handleDownloadPost, { content: "x" })).status, 400);
  assert.equal((await post(handleDownloadPost, { content: 5, type: "resume" })).status, 400);
  assert.equal((await post(handleDownloadPost, { content: "x", type: "memo" })).status, 400);
  assert.equal((await post(handleDownloadPost, { content: "x", type: "resume", format: "exe" })).status, 400);
  assert.equal((await post(handleDownloadPost, { content: "x".repeat(40_001), type: "resume" })).status, 413);
  assert.equal((await post(handleDownloadPost, { content: "x", type: "resume" }, { "content-length": "300000" })).status, 413);
  assert.equal((await post(handleDownloadPost, { content: "x", type: "resume", headerText: 5 })).status, 400);
  // every text field has the same cap, with a plain message
  const big = "x".repeat(40_001);
  for (const body of [{ content: "x", type: "cover_letter", headerText: big }, { content: "x", type: "resume", format: "zip", coverLetter: big }]) {
    const r = await post(handleDownloadPost, body);
    assert.equal(r.status, 413);
    assert.match(((await r.json()) as { error: string }).error, /longer than a resume or letter can be/);
  }
  assert.equal((await post(handleDownloadPost, { content: "x".repeat(40_000), type: "resume", format: "txt" })).status, 200, "exactly at the cap is accepted");
});

test("layout: page count in plain words, and the on-screen page on request", async () => {
  const r = await post(handleLayoutPost, { text: TWO_PAGE });
  const j = (await r.json()) as { pages: number; words: string; pagesHtml?: string };
  assert.equal(j.pages, 2);
  assert.equal(j.words, "2 full pages");
  assert.equal(j.pagesHtml, undefined);
  const s = await post(handleLayoutPost, { text: ONE_PAGE, screen: true });
  const sj = (await s.json()) as { pages: number; words: string; css: string; pagesHtml: string };
  assert.equal(sj.words, "Fits on 1 page");
  assert.match(sj.css, /url\(\/fonts\/resume\/Caladea-Regular\.ttf\)/);
  assert.doesNotMatch(sj.css, /@page/, "the app's own print layout is not touched");
  assert.match(sj.pagesHtml, /<section class="page/);
  assert.equal((await post(handleLayoutPost, { text: 5 })).status, 400);
  assert.equal((await post(handleLayoutPost, { text: "x".repeat(40_001) })).status, 413);
});

test("client helper: the name for the file comes from the top of the resume", () => {
  assert.equal(nameFromResumeText(ONE_PAGE), "Jordan Rivers");
  assert.equal(nameFromResumeText("555-1212 | a@b.com\nX"), "");
  assert.equal(nameFromResumeText(""), "");
});
