/**
 * Creative lane layouts: the artist resume (years at the left, titles in
 * italics, CAA order from core) and the bio card, in PDF, Word and HTML from
 * one layout, on the resume's fonts. Every person and place is invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { fontMeasurer } from "../resume-render/fonts";
import { layoutArtistResume, layoutBioCard, wrapParts, YEAR_COL, type ArtistResumeInput } from "../resume-render/creative";
import { buildCreative, renderCreativeDocx, renderCreativeHtml, renderCreativePdf } from "../resume-render";
import { crc32 } from "../resume-render/zip";
import { cleanCreativeRequest } from "../creative-render-handler";
import { buildArtistResumeModel } from "@crucible/core/src/creativeLaneShared";
import type { PracticeEntry } from "@crucible/core/src/practiceRecordShared";

let n = 0;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, user_id: "u", venue: null, city: null, state: null, end_year: null,
    details: {}, proof: "remembered", names_facility: false, created_at: "", updated_at: "", ...p,
  };
}
const ENTRIES = [
  entry({ section: "exhibition", title: "Shift Change", venue: "Riverside Arts Center", city: "Toledo", state: "OH", year: 2024, details: { kind: "solo" } }),
  entry({ section: "exhibition", title: "New Prints", venue: "Harbor Gallery", city: "Toledo", state: "OH", year: 2022, details: { kind: "group", juried: true } }),
  entry({ section: "arts_program", title: "Community Print Workshop", venue: "Toledo Arts Fund", year: 2018, end_year: 2020 }),
  entry({ section: "award", title: "Emerging Artist Grant", venue: "Toledo Arts Fund", year: 2023, details: { kind: "grant" } }),
];
const MODEL = buildArtistResumeModel(ENTRIES, { displayName: "Ray Example", discipline: "Painter and printmaker", email: "ray@example.com", basedIn: "Toledo, OH" });

async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    for (const item of tc.items as { str?: string; fontName?: string }[]) {
      if (typeof item.str === "string") text += item.str + " ";
    }
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { pages, text };
}

function docxXml(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
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
    assert.equal(crc32(data), crc);
    if (name === "word/document.xml") return data.toString("utf8");
    p += 46 + nlen + elen + clen;
  }
  throw new Error("no document.xml");
}

test("artist resume: years sit in the left column, the entry hangs beside them", () => {
  const { layout } = layoutArtistResume(MODEL, fontMeasurer());
  const lines = layout.pages[0].lines;
  const yearRun = lines.flatMap((l) => l.runs).find((r) => r.text === "2024")!;
  const titleRun = lines.flatMap((l) => l.runs).find((r) => r.text.startsWith("Shift Change"))!;
  assert.ok(yearRun && titleRun);
  assert.ok(titleRun.x - yearRun.x >= YEAR_COL - 0.01, "the entry starts at the years column");
  assert.equal(titleRun.face, "serifItalic", "show titles are italic");
  const venueRun = lines.flatMap((l) => l.runs).find((r) => r.text.includes("Riverside Arts Center"))!;
  assert.equal(venueRun.face, "serif");
});

test("artist resume: wrapped entries keep every word, in order, with the comma after the title", () => {
  const m = fontMeasurer();
  const parts = [{ text: "A Very Long Exhibition Title That Has To Wrap Across Lines", italic: true, after: "," }, { text: "Riverside Arts Center" }, { text: "Toledo, OH" }];
  const rows = wrapParts(m, parts, 10.5, 150);
  assert.ok(rows.length > 1);
  const joined = rows.map((r) => r.map((x) => x.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  assert.equal(joined, "A Very Long Exhibition Title That Has To Wrap Across Lines, Riverside Arts Center Toledo, OH");
});

test("artist resume: PDF, Word and HTML carry the same words; titles italic in Word and HTML (PDF italics: the layout test above)", async () => {
  const req = { doc: "artist_resume" as const, model: MODEL };
  const pdf = await pdfText(await renderCreativePdf(req));
  assert.equal(pdf.pages, 1);
  for (const w of ["RAY EXAMPLE", "SOLO EXHIBITIONS", "GROUP EXHIBITIONS", "Shift Change", "Riverside Arts Center", "2018-2020", "(juried)"]) {
    assert.ok(pdf.text.includes(w), `PDF has ${w}`);
  }
  const html = renderCreativeHtml(req);
  assert.match(html, /<span class="ey">2024<\/span><p class="et"><i>Shift Change<\/i>, Riverside Arts Center, Toledo, OH<\/p>/);
  assert.match(html, /<h2>EDUCATION AND TRAINING<\/h2>/);
  const xml = docxXml(await renderCreativeDocx(req));
  assert.match(xml, /<w:i\/>[\s\S]{0,200}Shift Change/);
  assert.match(xml, /2018-2020/);
  assert.ok(!/[\u2013\u2014]/.test(pdf.text + html + xml), "no en or em dashes anywhere");
});

test("artist resume: a DRAFT carries the DRAFT line and its to-do page", async () => {
  const pdf = await pdfText(await renderCreativePdf({ doc: "artist_resume", model: MODEL, draft: true, openItems: ["2020  Inside show: pick how this shows"] }));
  assert.equal(pdf.pages, 2);
  assert.ok(pdf.text.includes("DRAFT") && pdf.text.includes("YOUR TO-DO LIST"));
});

test("artist resume: a long record runs to more pages and says so", () => {
  const many = Array.from({ length: 90 }, (_, i) =>
    entry({ section: "exhibition", title: `Group Show ${i}`, venue: "Harbor Gallery", city: "Toledo", state: "OH", year: 1990 + (i % 30), details: { kind: "group" } })
  );
  const b = buildCreative({ doc: "artist_resume", model: buildArtistResumeModel(many, { displayName: "Ray Example" }) });
  assert.ok(b.layout.pages.length >= 2);
  assert.ok(b.layout.level.body >= 10, "never below 10 point");
});

test("bio card: each length with its counts; words as saved, dashes plain", async () => {
  const card = {
    name: "Ray Example",
    discipline: "Painter",
    bios: [
      { label: "Short bio", text: "Ray Example is a painter based in Toledo, OH.", words: 9, chars: 45 },
      { label: "Medium bio", text: "Ray Example is a painter based in Toledo, OH. Ray Example's work has been shown at Harbor Gallery.", words: 18, chars: 99 },
    ],
  };
  const { layout } = layoutBioCard(card, fontMeasurer());
  assert.equal(layout.pages.length, 1);
  const html = renderCreativeHtml({ doc: "bio", card });
  assert.match(html, /<h2>SHORT BIO<\/h2><p class="jo">9 words, 45 characters with spaces<\/p><p class="para">Ray Example is a painter based in Toledo, OH\.<\/p>/);
  const pdf = await pdfText(await renderCreativePdf({ doc: "bio", card }));
  assert.ok(pdf.text.includes("MEDIUM BIO"));
});

test("layout route input is rebuilt from known fields and bounded", () => {
  const r = cleanCreativeRequest({
    doc: "artist_resume",
    model: { header: { name: "Ray", contact: ["a", 5, "b"] }, sections: [{ heading: "Solo", rows: [{ years: "2024", parts: [{ text: "<b>x</b>", italic: "yes", after: ",,,,,," }], evil: 1 }] }] },
  });
  assert.ok(r && r.doc === "artist_resume");
  assert.deepEqual(r.model.header.contact, ["a", "b"]);
  assert.deepEqual(r.model.sections[0].rows[0].parts[0], { text: "<b>x</b>", italic: false, after: ",,," });
  const html = renderCreativeHtml(r);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"), "text is escaped");
  assert.equal(cleanCreativeRequest({ doc: "nope" }), null);
});

test("CV: house look, years at the left margin, sections in order; a paragraph section prints as typed", async () => {
  const { buildCvModel } = await import("@crucible/core/src/cvShared");
  const ed = entry({ section: "education", title: "BA, Sociology", venue: "Example State University", city: "Toledo", state: "OH", year: 2024, details: { degree: true, status: "conferred" } });
  const ta = entry({ section: "teaching", title: "Teaching Assistant", venue: "Example State University", year: 2023 });
  const model = buildCvModel([ed, ta], { displayName: "Ray Example", email: "ray@example.com", interests: "Adult literacy." }, "academic");
  const html = renderCreativeHtml({ doc: "cv", model });
  assert.match(html, /<h2>EDUCATION<\/h2><div class="en"><span class="ey">2024<\/span><p class="et">BA, Sociology, Example State University, Toledo, OH<\/p><\/div>/);
  assert.match(html, /<h2>INTERESTS<\/h2><p class="para">Adult literacy\.<\/p>/);
  assert.ok(html.indexOf("EDUCATION") < html.indexOf("INTERESTS") && html.indexOf("INTERESTS") < html.indexOf("TEACHING"));
  const pdf = await pdfText(await renderCreativePdf({ doc: "cv", model }));
  assert.equal(pdf.pages, 1);
  assert.ok(pdf.text.includes("RAY EXAMPLE") && pdf.text.includes("Teaching Assistant"));
  const xml = docxXml(await renderCreativeDocx({ doc: "cv", model }));
  assert.match(xml, /Teaching Assistant/);
  const r = cleanCreativeRequest({ doc: "cv", model: { header: { name: "R" }, sections: [{ heading: "X", text: "y".repeat(2000) }] } });
  assert.ok(r && r.doc === "cv" && (r.model.sections[0].text ?? "").length === 700);
});

test("performer page: 8x10 trim and US Letter, three columns, years only when turned on, one page", async () => {
  const { buildPerformerModel } = await import("@crucible/core/src/performerShared");
  const { layoutPerformer } = await import("../resume-render/creative");
  const { CREDIT_YEAR_COL } = await import("../resume-render/style");
  const play = entry({ section: "credit", title: "Our Town", venue: "Example Street Theatre", city: "Chicago", state: "IL", year: 2024, details: { medium: "theater", role: "Emily Webb", director: "J. Sample" } });
  const film = entry({ section: "credit", title: "Night Bus", venue: "Example Pictures", year: 2023, details: { medium: "film", billing: "supporting" } });
  const cls = entry({ section: "training", title: "Scene Study", venue: "Example Acting Studio", year: 2023, end_year: 2024, details: { teacher: "R. Coach" } });
  const union = entry({ section: "union", title: "SAG-AFTRA", year: 2024, details: { status: "member" } });
  const settings = { displayName: "Ray Example", discipline: "Actor / Singer", email: "ray@example.com", height: "5'10\"", ageRange: "25-35", skills: [{ text: "Stage combat", confirmed: true }] };
  const model = buildPerformerModel([play, film, cls, union], settings);
  const m = fontMeasurer();

  const small = layoutPerformer(model, m).layout;
  assert.deepEqual(small.page, { w: 576, h: 720 });
  assert.equal(small.pages.length, 1);
  const letter = layoutPerformer(model, m, { trim: "letter" }).layout;
  assert.equal(letter.page, undefined, "Letter is the default page");

  // Three columns: the production, the role and the company start at three different x positions on one line.
  const row = small.pages[0].lines.find((l) => l.runs.some((r) => r.text.includes("Our Town")))!;
  const xs = row.runs.map((r) => Math.round(r.x));
  assert.ok(new Set(xs).size >= 3, JSON.stringify(row.runs.map((r) => [r.text, r.x])));
  assert.ok(!row.runs.some((r) => r.text === "2024"), "credit years hidden by default");
  const withYears = layoutPerformer(buildPerformerModel([play, film, cls, union], { ...settings, showYears: true }), m).layout;
  const yrow = withYears.pages[0].lines.find((l) => l.runs.some((r) => r.text.includes("Our Town")))!;
  assert.equal(yrow.runs[0].text, "2024");
  assert.ok(yrow.runs[1].x - yrow.runs[0].x >= CREDIT_YEAR_COL);

  // PDF: the 8x10 MediaBox and every word; Letter on request.
  const pageSize = async (bytes: Uint8Array) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
    const view = (await doc.getPage(1)).view;
    await doc.destroy();
    return view.map((v: number) => Math.round(v));
  };
  const pdfBytes = await renderCreativePdf({ doc: "performer", model });
  assert.deepEqual(await pageSize(pdfBytes), [0, 0, 576, 720]);
  const pdf = await pdfText(pdfBytes);
  assert.equal(pdf.pages, 1);
  const flat = pdf.text.replace(/\s+/g, " ");
  for (const w of ["RAY EXAMPLE", "SAG-AFTRA Member", "Our Town", "Emily Webb", "Dir. J. Sample", "Supporting", "Scene Study", "Stage combat", "Age range 25-35"]) assert.ok(flat.includes(w), `${w} in ${flat}`);
  assert.deepEqual(await pageSize(await renderCreativePdf({ doc: "performer", model, trim: "letter" })), [0, 0, 612, 792]);

  // Word: a borderless table per credit and the 8x10 page.
  const xml = docxXml(await renderCreativeDocx({ doc: "performer", model }));
  assert.match(xml, /<w:pgSz w:w="11520" w:h="14400"/);
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /Emily Webb/);

  // HTML: the credit grid, the trim in @page, and no photo anywhere.
  const html = renderCreativeHtml({ doc: "performer", model });
  assert.match(html, /<div class="cr"><span><i>Our Town<\/i><\/span><span>Emily Webb<\/span><span>Example Street Theatre, Chicago, IL, Dir\. J\. Sample<\/span><\/div>/);
  assert.match(html, /@page\{size:576pt 720pt/);
  assert.doesNotMatch(html, /<img/);

  // The layout route rebuilds the request from known fields only.
  const r = cleanCreativeRequest({ doc: "performer", trim: "huge", model: { header: { name: "R", unions: ["A", 3] }, credits: [{ heading: "Theater", rows: [{ years: "2024", cols: [[{ text: "x" }], [], [], [{ text: "extra" }]] }] }], showYears: "yes" } });
  assert.ok(r && r.doc === "performer" && r.trim === "8x10" && r.model.showYears === false && r.model.credits[0].rows[0].cols.length === 3);
  assert.deepEqual(r && r.doc === "performer" ? r.model.header.unions : null, ["A"]);
});

test("performer page: a long record runs past one page and says so", async () => {
  const { buildPerformerModel } = await import("@crucible/core/src/performerShared");
  const { layoutPerformer } = await import("../resume-render/creative");
  const many = Array.from({ length: 60 }, (_, i) => entry({ section: "credit", title: `Example Play ${i}`, venue: "Example Street Theatre", year: 2000 + (i % 25), details: { medium: "theater", role: `Role ${i}` } }));
  const { layout } = layoutPerformer(buildPerformerModel(many, { displayName: "Ray Example" }), fontMeasurer());
  assert.ok(layout.pages.length > 1);
});

test("performer page (s2r3): a two-word part of a hidden name, a name people use for it and a lone town word, in every format, metadata and to-do page included", async () => {
  const { buildPerformerModel, performerShownIds } = await import("@crucible/core/src/performerShared");
  const { getPerformerStatus } = await import("@crucible/core/src/performerChecks");
  const { exportOpenItemLines } = await import("@crucible/core/src/creativeChecks");
  const { applyTitleMode, applyPhraseAnswer } = await import("@crucible/core/src/creativeLaneShared");
  const play = entry({ section: "credit", title: "Our Town", venue: "Example Street Theatre", year: 2024, details: { medium: "theater", role: "Emily Webb" } });
  const fol = entry({ section: "credit", title: "Inside Voices Showcase", venue: "Folsom State Prison", year: 2018, details: { medium: "theater", role: "Narrator", otherNames: ["Greystone"] }, names_facility: true });
  const two = entry({ section: "credit", title: "Night Shift", venue: "Example Players", year: 2022, details: { medium: "theater", role: "Folsom State guard" } });
  const nick = entry({ section: "training", title: "Voice", venue: "Greystone Studio", year: 2021 });
  const lake = entry({ section: "credit", title: "Lake Songs", venue: "Lakeside Hall", year: 2023, details: { medium: "music", role: "Townie from Folsom" } });
  const entries = [play, fol, two, nick, lake];
  // The whole hidden name in the name field: held, so the title metadata (built from the printed name) never carries it.
  const s0 = { ...applyTitleMode({ displayName: "Ray Example, Folsom State Prison", email: "ray@example.com" }, fol.id, "leave_out")!, agent: "Rep since the Folsom State days" };
  const allParts = (buf: Buffer) => {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let p = buf.readUInt32LE(eocd + 16);
    let out = "";
    for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
      const [method, csize, nlen, elen, clen, lho] = [buf.readUInt16LE(p + 10), buf.readUInt32LE(p + 20), buf.readUInt16LE(p + 28), buf.readUInt16LE(p + 30), buf.readUInt16LE(p + 32), buf.readUInt32LE(p + 42)];
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(start, start + csize);
      out += " " + (method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString("utf8");
      p += 46 + nlen + elen + clen;
    }
    return out;
  };
  const pdfAll = async (bytes: Uint8Array) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
    const meta = await doc.getMetadata();
    await doc.destroy();
    return `${(await pdfText(bytes)).text} META ${JSON.stringify(meta.info)}`;
  };
  const formats = async (s: typeof s0) => {
    const model = buildPerformerModel(entries, s);
    const status = getPerformerStatus({ entries, settings: s, model, pages: 1 });
    const openItems = exportOpenItemLines(status, entries, s, "performer", performerShownIds(model));
    const draft = status.blockCount > 0;
    const out: Record<string, string> = {};
    out.pdf8x10 = await pdfAll(await renderCreativePdf({ doc: "performer", model, trim: "8x10", draft, openItems }));
    out.pdfLetter = await pdfAll(await renderCreativePdf({ doc: "performer", model, trim: "letter", draft, openItems }));
    out.docx = allParts(await renderCreativeDocx({ doc: "performer", model, trim: "8x10", draft, openItems })).replace(/<[^>]+>/g, " ");
    out.html = renderCreativeHtml({ doc: "performer", model, trim: "letter", draft, openItems });
    for (const k of Object.keys(out)) out[k] = out[k].replace(/\s+/g, " ");
    return { model, status, out };
  };

  const a = await formats(s0);
  assert.equal(a.model.header.name, "");
  for (const [k, v] of Object.entries(a.out)) {
    assert.doesNotMatch(v, /Folsom State|Greystone|Inside Voices|Narrator/i, k);
    assert.match(v, /Townie from Folsom/, k);
    assert.match(v, /DRAFT/i, k);
    assert.doesNotMatch(v, /Ray Example/, `${k}: the held name never reaches the page or the metadata`);
  }
  assert.match(a.out.pdf8x10, /"Title":"Performer resume"/);
  assert.match(a.out.html, /<title>Performer resume<\/title>/);
  assert.match(a.out.docx, /Performer resume/);
  // The card for the town word is a FIX with no words of the person's in its line.
  const ask = a.status.openItems.find((x) => x.answer === "facility_word")!;
  assert.equal(ask.line, "2023  A line in your record");

  // "Yes, take it out": the town-word line comes off every format too.
  const y = await formats({ ...s0, ...applyPhraseAnswer(s0, ask.phrase, "yes")! });
  for (const [k, v] of Object.entries(y.out)) assert.doesNotMatch(v, /Folsom|Greystone|Inside Voices/i, k);
  // "No, that's something else": it prints, and is never asked again.
  const n = await formats({ ...s0, ...applyPhraseAnswer(s0, ask.phrase, "no")! });
  for (const [k, v] of Object.entries(n.out)) assert.match(v, /Townie from Folsom/, k);
  assert.ok(!n.status.openItems.some((x) => x.answer === "facility_word"));
});
