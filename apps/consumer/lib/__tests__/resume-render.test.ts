/**
 * Resume renderer: one layout model, three file formats.
 *
 * Fixtures are fictional (see fixtures/render-resumes.ts). Real fonts, real PDF
 * bytes: the PDF is read back with pdfjs (the same reader the upload path uses)
 * and with pdf-lib for the page count. No AI, no network, no database.
 *
 * Run: npm test  (node --import tsx --test)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import { fontMeasurer } from "../resume-render/fonts";
import { parseJobLine, parseResume, parseSkillsLine, plainDashes } from "../resume-render/model";
import { describeFit, layoutResume } from "../resume-render/layout";
import { build, cleanOpenItems, renderDocx, renderHtml, renderPdf } from "../resume-render";
import { buildZip, crc32 } from "../resume-render/zip";
import { FACE_FILES, LEVELS, SHAPE } from "../resume-render/style";
import { COVER_LETTER, ONE_PAGE, TWO_PAGE } from "./fixtures/render-resumes";

// ---- helpers -------------------------------------------------------------

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let out = "";
    for (const item of tc.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== "string") continue;
      out += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(out);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/** Words of a text, the way the checker reads them: no "|", no bullet markers, no end punctuation. */
function words(text: string): string[] {
  return text
    .replace(/\|/g, " ")
    .replace(/(^|\n)\s*[-*•]\s+/g, "$1")
    .split(/\s+/)
    .map((w) => w.replace(/^[.,;:()]+|[.,;:()]+$/g, "").toLowerCase())
    .filter(Boolean);
}

/** Minimal zip reader: entry names and bytes. */
function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out.set(name, data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

// ---- fonts ---------------------------------------------------------------

test("bundled fonts are real font files with a licence beside them", () => {
  const dir = path.join(process.cwd(), "public", "fonts", "resume");
  for (const file of Object.values(FACE_FILES)) {
    const b = fs.readFileSync(path.join(dir, file));
    assert.ok(b.length > 50_000, `${file} is a real font, not an error page (${b.length} bytes)`);
    assert.equal(b.readUInt32BE(0), 0x00010000, `${file} starts with the TrueType signature`);
  }
  for (const lic of ["OFL-Carlito.txt", "OFL-Caladea.txt"]) {
    const t = fs.readFileSync(path.join(dir, lic), "utf8");
    assert.match(t, /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});

test("measurer: real widths, Carlito and Caladea differ, bold is wider", () => {
  const m = fontMeasurer();
  const a = m.width("serif", "Warehouse Associate", 10.5);
  const b = m.width("sans", "Warehouse Associate", 10.5);
  assert.ok(a > 60 && a < 140, `serif width ${a}`);
  assert.notEqual(a.toFixed(2), b.toFixed(2));
  assert.ok(m.width("sansBold", "Warehouse", 10) > m.width("sans", "Warehouse", 10));
  assert.equal(m.width("serif", "", 10), 0);
});

// ---- parsing -------------------------------------------------------------

test("model: every job header shape the Forge writes is read as a job", () => {
  assert.deepEqual(parseJobLine("Warehouse Associate | Acme Logistics | Milwaukee, WI | 2023 - Present", true), {
    title: "Warehouse Associate", rest: ["Acme Logistics", "Milwaukee, WI"], years: "2023 - Present",
  });
  assert.deepEqual(parseJobLine("Shift Lead | Northgate Plastics | Milwaukee, WI", true), {
    title: "Shift Lead", rest: ["Northgate Plastics", "Milwaukee, WI"], years: "",
  });
  assert.deepEqual(parseJobLine("Operations Manager | Global Freight, 2016 - Present", true), {
    title: "Operations Manager", rest: ["Global Freight"], years: "2016 - Present",
  });
  assert.deepEqual(parseJobLine("Loader | Coop Street Freight, Milwaukee, 2018 - 2020", true), {
    title: "Loader", rest: ["Coop Street Freight, Milwaukee"], years: "2018 - 2020",
  });
  assert.deepEqual(parseJobLine("Forklift Certification | OSHA  2023", true), {
    title: "Forklift Certification", rest: ["OSHA"], years: "2023",
  });
  assert.equal(parseJobLine("Safety | Lean | Scheduling", true), null, "a skills list is not a job");
  assert.equal(parseJobLine("555 | jordan@example.com | Milwaukee", true), null, "a contact line is not a job");
});

test("model: skills lines keep whole items", () => {
  const sk = parseSkillsLine("Pack station: box size, packing slips | Manual pallet jack | Wrapping");
  assert.equal(sk?.label, "Pack station:");
  assert.equal(sk?.sep, "pipe");
  assert.deepEqual(sk?.items, ["box size, packing slips", "Manual pallet jack", "Wrapping"]);
  const c = parseSkillsLine("Equipment: pallet jack (manual, electric), scanner, saw");
  assert.deepEqual(c?.items, ["pallet jack (manual, electric)", "scanner", "saw"]);
});

test("model: header order follows the input and en/em dashes become a plain hyphen", () => {
  const m = parseResume(ONE_PAGE);
  assert.equal(m.header.name, "JORDAN RIVERS");
  assert.deepEqual(m.header.order, ["name", "contact", "headline"]);
  assert.equal(plainDashes("2019–2021"), "2019 - 2021");
  assert.equal(plainDashes("a — b"), "a - b");
  const withDash = parseResume("A B\nCity, ST | 555\n\nEXPERIENCE\nCook | Diner | 2019–2021\n- Made food — fast.\n");
  const job = withDash.blocks.find((b) => b.kind === "job");
  assert.equal(job && job.kind === "job" ? job.years : "", "2019 - 2021");
});

// ---- layout and page count ----------------------------------------------

test("fit words: plain words, never a percentage", () => {
  assert.equal(describeFit(1, 0, 0.6), "Fits on 1 page");
  assert.equal(describeFit(2, 3, 0.1), "Runs 3 lines onto page 2: cut or tighten");
  assert.equal(describeFit(2, 1, 0.05), "Runs 1 line onto page 2: cut or tighten");
  assert.equal(describeFit(2, 40, 0.8), "2 full pages");
  assert.equal(describeFit(2, 20, 0.3), "2 pages");
  for (const w of [describeFit(1, 0, 0.5), describeFit(2, 3, 0.1), describeFit(2, 40, 0.8)]) assert.doesNotMatch(w, /%/);
});

test("layout: one page fits on 1 page, a long resume is 2 full pages", () => {
  const m = fontMeasurer();
  const one = layoutResume(parseResume(ONE_PAGE), m);
  assert.equal(one.fit.pages, 1);
  assert.equal(one.fit.words, "Fits on 1 page");
  const two = layoutResume(parseResume(TWO_PAGE), m);
  assert.equal(two.fit.pages, 2);
  assert.equal(two.fit.words, "2 full pages");
});

test("layout: a resume a few lines over says how many lines to cut", () => {
  const m = fontMeasurer();
  // grow the one-page fixture until it just passes one page at the tightest fit
  let text = ONE_PAGE;
  let fit = layoutResume(parseResume(text), m).fit;
  let guard = 0;
  while (fit.pages === 1 && guard++ < 40) {
    text = text.replace("EDUCATION", `- Extra duty number ${guard}: covered breaks and kept the dock clean.\n\nEDUCATION`);
    fit = layoutResume(parseResume(text), m).fit;
  }
  assert.equal(fit.pages, 2);
  assert.match(fit.words, /^Runs \d+ lines? onto page 2: cut or tighten$/);
});

test("layout: dials loosen when there is room, tighten only to save a page, body never under 10 pt", () => {
  const m = fontMeasurer();
  assert.equal(layoutResume(parseResume(ONE_PAGE), m).layout.level.id, 0);
  for (const L of LEVELS) {
    assert.ok(L.body >= 10 && L.body <= 11);
    assert.ok(L.marginTop >= 0.45 * 72 - 0.001 && L.marginBottom >= 0.45 * 72 - 0.001);
  }
  assert.ok(SHAPE.sepMargin <= 0.5);
});

test("layout: no line ends on a separator, and every page after the first starts with its name line", () => {
  const m = fontMeasurer();
  const { layout } = layoutResume(parseResume(TWO_PAGE), m);
  for (const p of layout.pages) {
    for (const l of p.lines) assert.ok(!l.runs[l.runs.length - 1]?.sep, "separator at a line end");
  }
  const second = layout.pages[1].lines.find((l) => l.extra);
  assert.equal(second?.runs[0].text, "MORGAN CASEY, page 2");
});

test("layout: a job header is never left alone at the bottom of a page", () => {
  const m = fontMeasurer();
  const { layout } = layoutResume(parseResume(TWO_PAGE), m);
  for (const p of layout.pages.slice(0, -1)) {
    const last = p.lines[p.lines.length - 1];
    const block = layout.blocks[last.blockId];
    assert.ok(block && block.src.kind !== "job" && block.src.kind !== "section", `page ${p.number} ends on a ${block?.src.kind}`);
  }
});

// ---- PDF -----------------------------------------------------------------

test("pdf: page count from the file equals the layout's count, one page and two", async () => {
  for (const [text, expected] of [[ONE_PAGE, 1], [TWO_PAGE, 2]] as const) {
    const bytes = await renderPdf({ text });
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), expected);
    assert.equal(build({ text }).fit.pages, expected);
    assert.equal((await pdfPages(bytes)).length, expected);
  }
});

test("pdf: word for word, in order (extracted text equals the input text)", async () => {
  for (const text of [ONE_PAGE, TWO_PAGE]) {
    const pages = await pdfPages(await renderPdf({ text }));
    const got = words(pages.map((p, i) => (i > 0 ? p.replace(/^.*, page \d+\s*/, "") : p)).join("\n"));
    const want = words(text);
    assert.deepEqual(got, want);
  }
});

test("pdf: the name line sits at the top of page 2 as ordinary text", async () => {
  const pages = await pdfPages(await renderPdf({ text: TWO_PAGE }));
  assert.match(pages[1].trimStart(), /^MORGAN CASEY, page 2/);
  assert.doesNotMatch(pages[0], /page 2/);
});

test("pdf: no en or em dash, no bullet glyph, no spaced-letter headings", async () => {
  const pages = await pdfPages(await renderPdf({ text: ONE_PAGE + "\n- Moved freight — on time.\n" }));
  const all = pages.join("\n");
  assert.doesNotMatch(all, /[–—•▪]/);
  assert.match(all, /CAREER SUMMARY/);
  assert.match(all, /PROFESSIONAL EXPERIENCE/);
});

test("pdf: DRAFT line on every page and a separate to-do page that says it is not the resume", async () => {
  const bytes = await renderPdf({ text: TWO_PAGE, draft: true, openItems: ["Add the year you left Coop Street Freight.", "Check the phone number."] });
  const pages = await pdfPages(bytes);
  assert.equal(pages.length, 3, "two resume pages plus the to-do page");
  for (const p of pages) assert.match(p, /DRAFT/);
  assert.match(pages[1], /MORGAN CASEY, page 2/);
  assert.match(pages[2], /YOUR TO-DO LIST/);
  assert.match(pages[2], /not part of your resume/);
  assert.match(pages[2], /Add the year you left Coop Street Freight/);
  // the resume pages themselves never carry the list
  assert.doesNotMatch(pages[0] + pages[1], /TO-DO LIST/);
});

test("pdf: a finished resume (draft false) carries no DRAFT mark and no to-do page", async () => {
  const pages = await pdfPages(await renderPdf({ text: ONE_PAGE, draft: false, openItems: ["Should not appear"] }));
  assert.equal(pages.length, 1);
  assert.doesNotMatch(pages.join(""), /DRAFT|Should not appear/);
});

test("pdf: draft with nothing open still marks every page", async () => {
  const pages = await pdfPages(await renderPdf({ text: ONE_PAGE, draft: true }));
  assert.equal(pages.length, 1);
  assert.match(pages[0], /DRAFT/);
});

test("pdf: cover letter carries the resume's name and contact line", async () => {
  const pages = await pdfPages(await renderPdf({ text: COVER_LETTER, kind: "cover_letter", headerText: ONE_PAGE }));
  assert.equal(pages.length, 1);
  assert.match(pages[0], /JORDAN RIVERS/);
  assert.match(pages[0], /Dear Hiring Team/);
  assert.match(pages[0], /Sincerely/);
});

// ---- Word ----------------------------------------------------------------

test("docx: one column, no tables, no header or footer, Cambria and Calibri names", async () => {
  const z = readZip(await renderDocx({ text: TWO_PAGE }));
  const xml = z.get("word/document.xml")!.toString("utf8");
  assert.ok(![...z.keys()].some((k) => /header|footer/i.test(k)), "no header or footer parts");
  assert.doesNotMatch(xml, /<w:tbl>/);
  assert.match(xml, /w:ascii="Cambria"/);
  assert.match(xml, /w:ascii="Calibri"/);
  assert.doesNotMatch(xml, /[–—]/);
  // sections: US Letter, no columns
  assert.match(xml, /w:w="12240" w:h="15840"/);
  assert.doesNotMatch(xml, /<w:cols /);
});

test("docx: 'Name, page 2' is ordinary text at the top of page 2, after one page break", async () => {
  const xml = readZip(await renderDocx({ text: TWO_PAGE })).get("word/document.xml")!.toString("utf8");
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 1);
  // the break is on the paragraph that holds the "Name, page 2" text
  assert.match(xml, /<w:p>(?:(?!<\/w:p>)[^])*<w:pageBreakBefore\/>(?:(?!<\/w:p>)[^])*MORGAN CASEY, page 2/);
});

test("docx: draft marks every page and ends with the to-do page", async () => {
  const xml = readZip(await renderDocx({ text: TWO_PAGE, draft: true, openItems: ["Check the phone number."] })).get("word/document.xml")!.toString("utf8");
  assert.equal((xml.match(/>DRAFT</g) || []).length, 3, "page 1, page 2 and the to-do page");
  assert.match(xml, /YOUR TO-DO LIST/);
  assert.match(xml, /Check the phone number\./);
});

test("docx: every word of the resume is there, sections in order (years sit beside the title, as drawn)", async () => {
  const xml = readZip(await renderDocx({ text: ONE_PAGE })).get("word/document.xml")!.toString("utf8");
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ").replace(/&amp;/g, "&");
  const bag = (ws: string[]) => ws.filter((w) => w !== "-").sort();
  assert.deepEqual(bag(words(text)), bag(words(ONE_PAGE)));
  const heads = ["CAREER SUMMARY", "CORE COMPETENCIES", "PROFESSIONAL EXPERIENCE", "EDUCATION", "CERTIFICATIONS"].map((h) => text.indexOf(h));
  assert.ok(heads.every((h, i) => h >= 0 && (i === 0 || h > heads[i - 1])), "section headings in order");
  // one job row is a title, a right tab, then the years, as ordinary text in one paragraph
  assert.ok(/Warehouse Associate<\/w:t>(?:(?!<\/w:p>)[^])*<w:tab\/>(?:(?!<\/w:p>)[^])*2021 - Present/.test(xml), "title, tab, years in one paragraph");
});

// ---- HTML ----------------------------------------------------------------

test("html: self-contained, fonts embedded, same page count, no dashes, separators hidden from readers", () => {
  const html = renderHtml({ text: TWO_PAGE });
  assert.match(html, /@font-face\{font-family:'ResumeSerif'/);
  assert.match(html, /@font-face\{font-family:'ResumeSans'/);
  assert.equal((html.match(/data:font\/ttf;base64,/g) || []).length, 5);
  assert.doesNotMatch(html, /src:url\(https?:/, "no outside fonts");
  assert.doesNotMatch(html, /<script/i);
  assert.equal((html.match(/<section class="page/g) || []).length, 2);
  assert.doesNotMatch(html, /[–—]/);
  assert.match(html, /class="sep" aria-hidden="true"/);
  assert.match(html, /MORGAN CASEY, page 2/);
});

test("html: escapes what it is given", () => {
  const html = renderHtml({ text: "A <b>B</b>\nCity, ST | 555\n\nSUMMARY\nSays <script>alert(1)</script> & more.\n" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("html: draft adds the DRAFT line to every page and the to-do page", () => {
  const html = renderHtml({ text: TWO_PAGE, draft: true, openItems: ["Check the phone number."] });
  assert.equal((html.match(/class="pageline draft">DRAFT</g) || []).length, 3);
  assert.match(html, /YOUR TO-DO LIST/);
});

// ---- zip and inputs ------------------------------------------------------

test("zip: entries round-trip with the right checksums", () => {
  const z = buildZip([
    { name: "a.txt", data: new TextEncoder().encode("hello hello hello hello") },
    { name: "b-c.bin", data: new Uint8Array([1, 2, 3, 4]) },
  ]);
  const files = readZip(z);
  assert.equal(files.get("a.txt")!.toString(), "hello hello hello hello");
  assert.deepEqual([...files.get("b-c.bin")!], [1, 2, 3, 4]);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("openItems are cleaned: plain strings only, capped, no dashes", () => {
  assert.deepEqual(cleanOpenItems(["  Fix   this — now  ", 5, "", null, "Two"]), ["Fix this - now", "Two"]);
  assert.equal(cleanOpenItems(Array.from({ length: 80 }, (_, i) => `item ${i}`)).length, 30);
  assert.equal(cleanOpenItems("nope").length, 0);
  assert.equal(cleanOpenItems(["x".repeat(900)])[0].length, 300);
});

test("renderer survives odd input: empty body, one long unbroken word, huge bullet", async () => {
  const odd = "NAME ONLY\n\nSUMMARY\n" + "x".repeat(400) + "\n\nEXPERIENCE\nCook | Diner | 2019 - 2021\n- " + "word ".repeat(300) + "\n";
  const pages = await pdfPages(await renderPdf({ text: odd }));
  assert.ok(pages.length >= 1);
  const empty = await renderPdf({ text: "   " });
  assert.ok((await PDFDocument.load(empty)).getPageCount() >= 1);
});

// ---- memory: nothing keyed by anyone's text outlives a request -----------

import vm from "node:vm";
import v8 from "node:v8";
import { renderScreen } from "../resume-render";
import { sharedTextStateSize } from "../resume-render/fonts";

function bigResume(seed: number, chars: number): string {
  const lines = ["PAT " + seed, "City, ST | 555-0100 | pat@example.com", "Operations Lead", "", "PROFESSIONAL EXPERIENCE", ""];
  let i = 0;
  while (lines.join("\n").length < chars) {
    lines.push(`Role ${seed}-${i} | Employer ${seed}-${i} | City, ST | 20${10 + (i % 10)} - 20${11 + (i % 10)}`);
    for (let b = 0; b < 4; b++) lines.push(`- Unique line ${seed}-${i}-${b}: moved freight ${seed * 7 + i * 3 + b} pallets across the dock and checked every count against paperwork number ${seed}${i}${b}.`);
    lines.push("");
    i++;
  }
  return lines.join("\n");
}

test("measurer: the width cache belongs to one measurer, and a new one starts empty", () => {
  const a = fontMeasurer();
  assert.equal(a.cacheSize(), 0);
  layoutResume(parseResume(ONE_PAGE), a);
  assert.ok(a.cacheSize() > 0);
  const b = fontMeasurer();
  assert.notEqual(a, b, "never one shared measurer");
  assert.equal(b.cacheSize(), 0);
  assert.equal(sharedTextStateSize(), 0);
});

test("a render keeps nothing: 20 different large inputs leave no growing state", async () => {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  const heap = () => {
    gc();
    gc();
    return process.memoryUsage().heapUsed / 1048576;
  };
  // warm up once so fonts and code are loaded before measuring
  await renderPdf({ text: bigResume(0, 40_000) });
  const before = heap();
  const sizes: number[] = [];
  for (let n = 1; n <= 20; n++) {
    const text = bigResume(n, 40_000);
    build({ text });
    renderScreen({ text }, () => "/x.ttf");
    sizes.push(sharedTextStateSize());
    if (n % 5 === 0) await renderPdf({ text });
  }
  const after = heap();
  assert.ok(sizes.every((x) => x === 0));
  // Before the fix this grew about 16 MB per 200k-char request and never fell back.
  assert.ok(after - before < 15, `heap grew ${(after - before).toFixed(1)} MB over 20 large renders`);
});

// ---- property: every input word comes out, in every path -----------------

import { renderScreen as screenOf } from "../resume-render";

const ODD_HEADERS = [
  "JANE TESTER\nMilwaukee, WI\n(555) 010-0100\nCertified Welder\n\nSUMMARY\nSteady welder.\n\nEXPERIENCE\nWelder | Shop | 2019 - 2021\n- Welded frames.\n",
  "Name Only\n\nSUMMARY\nJust a name and a line.\n",
  "A B\nWelder\nWelder\na@b.com\n\nSUMMARY\nHi there.\n",
  "A B\nline two\nline three\nline four\nline five\nline six\n\nSUMMARY\nBody.\n",
  "A B\n555-0100 | a@b.com\nHeadline words here\nOpen to Michigan\nExtra stray line\nSUMMARY\nHi.\n",
  "A B\n\n\nSUMMARY\nBlank lines before the first section.\n- A bullet with a number 2024 and a & sign.\n",
  "LEADERSHIP\nOne item.\n",
];

function htmlText(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
const bag = (ws: string[]) => ws.filter((w) => w !== "-").sort();
const stripPageLines = (t: string) => t.replace(/(^|\n|\s)[A-Z][^\n,]{0,40}, page \d+/g, " ");

for (const [i, text] of [ONE_PAGE, TWO_PAGE, ...ODD_HEADERS].entries()) {
  test(`every input word comes out in the PDF, HTML and screen paths (case ${i})`, async () => {
    const want = bag(words(text));
    const pdfText = (await pdfPages(await renderPdf({ text }))).map((p, k) => (k > 0 ? stripPageLines(p) : p)).join("\n");
    assert.deepEqual(bag(words(pdfText)), want, "PDF");
    assert.deepEqual(bag(words(stripPageLines(htmlText(renderHtml({ text }))))), want, "HTML");
    const screen = screenOf({ text }, () => "/x.ttf");
    assert.deepEqual(bag(words(stripPageLines(htmlText(screen.pagesHtml)))), want, "screen");
  });
}
