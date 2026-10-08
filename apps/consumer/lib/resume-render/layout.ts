/**
 * The one layout model for the resume page.
 *
 * Input is a ResumeModel (the Forge's resume text, parsed). Output is a list of
 * US Letter pages, each a list of positioned text runs, rules and bullet
 * squares, laid out with REAL font metrics supplied by a Measurer. The PDF
 * builder draws these positions directly; the Word and HTML builders use the
 * same fit level, spacing and page breaks, so all three formats paginate alike.
 *
 * Pure: no fs, no fonts. The server supplies a Measurer built from the bundled
 * Carlito and Caladea files (see fonts.ts); tests supply a fixed-width one.
 *
 * Words are never changed here. What goes in comes out, in order.
 */

import {
  COLORS,
  LEVELS,
  PAGE_H,
  PAGE_W,
  SHAPE,
  type FaceKey,
  type Level,
} from "./style";
import type { LetterModel, ModelBlock, ModelHeader, ResumeModel } from "./model";
import { splitPipes } from "./model";

export interface Measurer {
  /** Width in points of `text` set in `face` at `size`. No kerning (matches PDF and Word). */
  width(face: FaceKey, text: string, size: number): number;
  /** Ascent and descent as fractions of the font size. */
  ascent(face: FaceKey): number;
  descent(face: FaceKey): number;
}

export interface Run {
  text: string;
  face: FaceKey;
  size: number;
  color: string;
  /** Points from the left edge of the content area (blocks) or the page (placed). */
  x: number;
  /** Draw after the other runs of this block (keeps title, employer, place, years order). */
  defer?: boolean;
  /** A drawn separator ("|"): aria-hidden in HTML, accent colour. */
  sep?: boolean;
}

export interface LineSpec {
  runs: Run[];
  height: number;
  /** Baseline distance from the top of the line box. */
  baseline: number;
  /** Extra gap above this line inside its block. */
  gapBefore: number;
  /** Rule drawn under the line: gap below the box, thickness, colour. */
  rule?: { gap: number; w: number; color: string };
  /** Bullet square on this line: x from content left, size. */
  square?: { x: number; size: number };
  extra?: boolean;
  /** Reading rank inside its block (header lines keep the order they came in). */
  readRank?: number;
}

export interface BlockSpec {
  id: number;
  /** The model block this came from (null for header and page extras). */
  src:
    | ModelBlock
    | { kind: "header" }
    | { kind: "letter-para"; lines: string[] }
    | { kind: "letter-closing"; lines: string[] }
    | EntrySrc;
  before: number;
  after: number;
  lines: LineSpec[];
  keepNext: boolean;
}

/**
 * A dated entry (artist resume): the years sit in a left column, the entry
 * text hangs beside them. Parts keep their italics (titles of works and
 * shows) and the punctuation after them, in order.
 */
export interface EntrySrc {
  kind: "entry";
  years: string;
  parts: { text: string; italic?: boolean; after?: string }[];
}

export interface PlacedLine {
  /** Baseline, points from the top of the page. */
  y: number;
  top: number;
  height: number;
  runs: Run[];
  blockId: number; // -1 for page extras
  rule?: { y: number; w: number; color: string; x1: number; x2: number };
  square?: { x: number; y: number; size: number };
  extra?: boolean;
  readRank?: number;
}

export interface PlacedPage {
  number: number;
  lines: PlacedLine[];
  /** Lowest point used, points from the top. */
  bottomUsed: number;
}

export interface Layout {
  level: Level;
  pages: PlacedPage[];
  blocks: BlockSpec[];
  /** First block id on each page (page 1 is always block 0). */
  pageStartBlocks: number[];
  name: string;
  draft: boolean;
}

export interface FitInfo {
  pages: number;
  /** Lines that would have to go to bring the resume down one page, at the tightest fit. */
  spillLines: number;
  /** How full the last page is at the tightest fit (0 to 1). */
  lastPageFill: number;
  /** Plain words for the person. */
  words: string;
}

export interface RenderOptions {
  draft?: boolean;
  openItems?: string[];
}

// ---------------------------------------------------------------------------
// Text flow helpers
// ---------------------------------------------------------------------------

export function lineBox(m: Measurer, face: FaceKey, size: number, lh: number) {
  const height = size * lh;
  const asc = m.ascent(face) * size;
  const desc = m.descent(face) * size;
  const baseline = (height - (asc + desc)) / 2 + asc;
  return { height, baseline };
}

/** Break chances inside a word: after a hyphen between letters or digits, as browsers and Word do. */
function wordPieces(word: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < word.length; i++) {
    cur += word[i];
    if (word[i] === "-" && i > 0 && i < word.length - 1 && /[A-Za-z0-9]/.test(word[i - 1]) && /[A-Za-z0-9]/.test(word[i + 1])) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Greedy word wrap. A piece wider than the line is broken by characters. */
export function wrapText(m: Measurer, text: string, face: FaceKey, size: number, width: number, firstWidth?: number): string[] {
  const atoms: { t: string; space: boolean }[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    wordPieces(w).forEach((piece, i) => atoms.push({ t: piece, space: i === 0 }));
  }
  const lines: string[] = [];
  let cur = "";
  let limit = firstWidth ?? width;
  const spaceW = m.width(face, " ", size);
  const newLine = () => {
    lines.push(cur);
    cur = "";
    limit = width;
  };
  const breakLong = (piece: string) => {
    let part = "";
    for (const ch of piece) {
      if (m.width(face, part + ch, size) > limit && part) {
        cur = part;
        newLine();
        part = ch;
      } else part += ch;
    }
    cur = part;
  };
  for (const a of atoms) {
    const aw = m.width(face, a.t, size);
    if (!cur) {
      if (aw <= limit) cur = a.t;
      else breakLong(a.t);
      continue;
    }
    const add = (a.space ? spaceW : 0) + aw;
    if (m.width(face, cur, size) + add <= limit) cur += (a.space ? " " : "") + a.t;
    else {
      newLine();
      if (aw <= limit) cur = a.t;
      else breakLong(a.t);
    }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

interface FlowOpts {
  face: FaceKey;
  size: number;
  color: string;
  sep: "pipe" | "comma";
  width: number;
  label?: { text: string; face: FaceKey; color: string };
}

/**
 * Flow whole items (a skill, a contact piece) onto lines. A line never ends on a
 * separator: the separator is only drawn between two items on the same line.
 * An item wider than a line is word-wrapped on its own.
 */
function flowItems(m: Measurer, items: string[], o: FlowOpts): Run[][] {
  const lines: Run[][] = [[]];
  let x = 0;
  let lineHasItem = false;
  const cur = () => lines[lines.length - 1];
  const space = m.width(o.face, " ", o.size);
  if (o.label) {
    cur().push({ text: o.label.text, face: o.label.face, size: o.size, color: o.label.color, x: 0 });
    x = m.width(o.label.face, o.label.text, o.size) + space;
  }
  const sepW = m.width("sansBold", "|", o.size);
  const sepGap = SHAPE.sepMargin * o.size;
  items.forEach((item, idx) => {
    const text = o.sep === "comma" && idx < items.length - 1 ? item + "," : item;
    const w = m.width(o.face, text, o.size);
    let lead = lineHasItem ? (o.sep === "pipe" ? sepGap + sepW + sepGap : space) : 0;
    if (lineHasItem && x + lead + w > o.width + 0.01) {
      lines.push([]);
      x = 0;
      lineHasItem = false;
      lead = 0;
    }
    if (lineHasItem && o.sep === "pipe") {
      cur().push({ text: "|", face: "sansBold", size: o.size, color: COLORS.accent, x: x + sepGap, sep: true });
    }
    x += lead;
    if (x + w > o.width + 0.01) {
      // an item wider than the line: wrap its words
      const parts = wrapText(m, text, o.face, o.size, o.width, Math.max(1, o.width - x));
      parts.forEach((p, i) => {
        if (i > 0) {
          lines.push([]);
          x = 0;
        }
        cur().push({ text: p, face: o.face, size: o.size, color: o.color, x });
        x += m.width(o.face, p, o.size);
      });
    } else {
      cur().push({ text, face: o.face, size: o.size, color: o.color, x });
      x += w;
    }
    lineHasItem = true;
  });
  return lines.filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

export function textLines(m: Measurer, text: string, face: FaceKey, size: number, color: string, width: number, lh: number, x0 = 0): LineSpec[] {
  return wrapText(m, text, face, size, width).map((t) => {
    const b = lineBox(m, face, size, lh);
    return { runs: [{ text: t, face, size, color, x: x0 }], height: b.height, baseline: b.baseline, gapBefore: 0 };
  });
}

function runsLines(m: Measurer, rows: Run[][], face: FaceKey, size: number, lh: number, x0 = 0): LineSpec[] {
  return rows.map((runs) => {
    const b = lineBox(m, face, size, lh);
    return { runs: runs.map((r) => ({ ...r, x: r.x + x0 })), height: b.height, baseline: b.baseline, gapBefore: 0 };
  });
}

function pipeItems(text: string): string[] {
  return /\s[|•]\s/.test(text) ? splitPipes(text) : [text];
}

export function headerBlock(m: Measurer, h: ModelHeader, L: Level, W: number, id: number): BlockSpec | null {
  const lines: LineSpec[] = [];
  const order = h.order ?? ["name", "headline", "contact", "notes"];
  const rank = (k: "name" | "headline" | "contact" | "notes") => {
    const i = order.indexOf(k);
    return i < 0 ? 9 : i;
  };
  const add = (k: "name" | "headline" | "contact" | "notes", specs: LineSpec[], gap: number) =>
    specs.forEach((l, i) => lines.push({ ...l, gapBefore: i === 0 ? gap : 0, readRank: rank(k) }));
  if (h.name) {
    const specs = wrapText(m, h.name.toUpperCase(), "serifBold", L.nameSize, W).map((t) => {
      const b = lineBox(m, "serifBold", L.nameSize, 1.12);
      return { runs: [{ text: t, face: "serifBold" as FaceKey, size: L.nameSize, color: COLORS.ink, x: 0 }], height: b.height, baseline: b.baseline, gapBefore: 0 };
    });
    add("name", specs, 0);
  }
  if (h.headline) {
    const rows = flowItems(m, pipeItems(h.headline), { face: "sansBold", size: SHAPE.headlineSize, color: COLORS.accent, sep: "pipe", width: W });
    add("headline", runsLines(m, rows, "sansBold", SHAPE.headlineSize, 1.25), 4);
  }
  if (h.contact) {
    const rows = flowItems(m, pipeItems(h.contact), { face: "sans", size: SHAPE.contactSize, color: COLORS.soft, sep: "pipe", width: W });
    add("contact", runsLines(m, rows, "sans", SHAPE.contactSize, 1.25), 3);
  }
  if (h.notes) {
    add("notes", textLines(m, h.notes, "serif", SHAPE.contactSize, COLORS.soft, W, 1.25), 3);
  }
  if (!lines.length) return null;
  lines[lines.length - 1].rule = { gap: 6, w: SHAPE.accentRule, color: COLORS.accent };
  return { id, src: { kind: "header" }, before: 0, after: 4, lines, keepNext: false };
}

function resumeBlocks(m: Measurer, model: ResumeModel, L: Level): BlockSpec[] {
  const W = PAGE_W - 2 * L.marginSide;
  const out: BlockSpec[] = [];
  let id = 0;
  const hb = headerBlock(m, model.header, L, W, id);
  if (hb) {
    out.push(hb);
    id++;
  }
  const body = L.body;
  for (const b of model.blocks) {
    let spec: BlockSpec;
    switch (b.kind) {
      case "section": {
        const box = lineBox(m, "sansBold", SHAPE.headingSize, 1.25);
        spec = {
          id, src: b, before: L.sectionBefore, after: L.sectionAfter, keepNext: true,
          lines: [{
            runs: [{ text: b.text, face: "sansBold", size: SHAPE.headingSize, color: COLORS.accent, x: 0 }],
            height: box.height, baseline: box.baseline, gapBefore: 0,
            rule: { gap: 2, w: SHAPE.headingRule, color: COLORS.rule },
          }],
        };
        break;
      }
      case "para": {
        if (b.role === "overview") {
          spec = { id, src: b, before: 1.5, after: 2, keepNext: false, lines: textLines(m, b.text, "serifItalic", Math.max(10, body - 0.25), COLORS.soft, W, L.lineHeight) };
        } else {
          spec = { id, src: b, before: 0, after: L.paraAfter, keepNext: false, lines: textLines(m, b.text, "serif", body, COLORS.ink, W, L.lineHeight) };
        }
        break;
      }
      case "job": {
        const titleSize = body + 0.5;
        const yearsW = b.years ? m.width("sansBold", b.years, SHAPE.metaSize) : 0;
        const titleW = b.years ? W - yearsW - SHAPE.jobGap : W;
        const lines: LineSpec[] = [];
        wrapText(m, b.title, "serifBold", titleSize, titleW).forEach((t, i) => {
          const box = lineBox(m, "serifBold", titleSize, L.lineHeight - 0.04);
          const runs: Run[] = [{ text: t, face: "serifBold", size: titleSize, color: COLORS.ink, x: 0 }];
          if (i === 0 && b.years) {
            runs.push({ text: b.years, face: "sansBold", size: SHAPE.metaSize, color: COLORS.ink, x: W - yearsW, defer: true });
          }
          lines.push({ runs, height: box.height, baseline: box.baseline, gapBefore: 0 });
        });
        if (b.rest.length) {
          const rows = flowItems(m, b.rest, { face: "sansBold", size: SHAPE.metaSize, color: COLORS.soft, sep: "pipe", width: W });
          runsLines(m, rows, "sansBold", SHAPE.metaSize, L.lineHeight - 0.06).forEach((l) => lines.push(l));
        }
        spec = { id, src: b, before: L.jobBefore, after: 1.5, keepNext: false, lines };
        break;
      }
      case "bullet": {
        const lines = textLines(m, b.text, "serif", body, COLORS.ink, W - SHAPE.bulletIndent, L.lineHeight, SHAPE.bulletIndent);
        lines[0].square = { x: 1, size: SHAPE.bulletSquare };
        spec = { id, src: b, before: 0, after: L.bulletAfter, keepNext: false, lines };
        break;
      }
      case "skills": {
        const rows = flowItems(m, b.items, {
          face: "serif", size: body, color: COLORS.ink, sep: b.sep, width: W,
          label: b.label ? { text: b.label, face: "sansBold", color: COLORS.accent } : undefined,
        });
        spec = { id, src: b, before: 0, after: L.paraAfter, keepNext: false, lines: runsLines(m, rows, "serif", body, L.lineHeight) };
        break;
      }
    }
    out.push(spec);
    id++;
  }
  // keep a job header with its overview and first bullet; a section with what follows
  for (let i = 0; i < out.length - 1; i++) {
    const s = out[i].src;
    const n = out[i + 1].src;
    if (s.kind === "job") out[i].keepNext = n.kind === "bullet" || (n.kind === "para" && n.role === "overview");
    if (s.kind === "para" && s.role === "overview") out[i].keepNext = n.kind === "bullet";
  }
  return out;
}

function letterBlocks(m: Measurer, model: LetterModel, L: Level): BlockSpec[] {
  const W = PAGE_W - 2 * L.marginSide;
  const out: BlockSpec[] = [];
  let id = 0;
  const hb = headerBlock(m, model.header, L, W, id);
  if (hb) {
    out.push(hb);
    id++;
  }
  const size = L.body + 0.5;
  for (const b of model.blocks) {
    if (b.kind === "para") {
      out.push({ id, src: { kind: "letter-para", lines: b.lines }, before: 0, after: size * 0.75, keepNext: false, lines: textLines(m, b.lines.join(" "), "serif", size, COLORS.ink, W, L.lineHeight + 0.03) });
    } else {
      const lines: LineSpec[] = [];
      b.lines.forEach((t, i) => {
        const box = lineBox(m, i === 0 ? "serif" : "serifBold", size, L.lineHeight + 0.03);
        lines.push({ runs: [{ text: t, face: i === 0 ? "serif" : "serifBold", size, color: COLORS.ink, x: 0 }], height: box.height, baseline: box.baseline, gapBefore: i === 1 ? size * 1.2 : 0 });
      });
      out.push({ id, src: { kind: "letter-closing", lines: b.lines }, before: 0, after: size * 0.75, keepNext: false, lines });
    }
    id++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function lineAdvance(l: LineSpec): number {
  return l.gapBefore + l.height + (l.rule ? l.rule.gap + l.rule.w : 0);
}
function blockHeight(b: BlockSpec): number {
  return b.lines.reduce((s, l) => s + lineAdvance(l), 0);
}

function pageExtras(m: Measurer, L: Level, name: string, pageNo: number, draft: boolean): LineSpec[] {
  const size = SHAPE.pageLineSize;
  const out: LineSpec[] = [];
  if (draft) {
    const b = lineBox(m, "sansBold", size, 1.3);
    out.push({ runs: [{ text: "DRAFT", face: "sansBold", size, color: COLORS.soft, x: 0 }], height: b.height, baseline: b.baseline, gapBefore: 0, extra: true });
  }
  if (pageNo >= 2) {
    const b = lineBox(m, "sans", size, 1.3);
    const text = name ? `${name}, page ${pageNo}` : `Page ${pageNo}`;
    out.push({ runs: [{ text, face: "sans", size, color: COLORS.soft, x: 0 }], height: b.height, baseline: b.baseline, gapBefore: 0, extra: true });
  }
  if (out.length) out[out.length - 1].rule = undefined;
  return out;
}

export function paginate(m: Measurer, blocks: BlockSpec[], L: Level, name: string, draft: boolean, extrasAfter = 6): Layout {
  const bottom = PAGE_H - L.marginBottom;
  const contentH = bottom - L.marginTop;
  const pages: PlacedPage[] = [];
  const pageStartBlocks: number[] = [];
  let page!: PlacedPage;
  let y = 0;
  let pendingAfter = 0;
  let atTop = true;

  const place = (line: LineSpec, blockId: number) => {
    const top = y + line.gapBefore;
    const placed: PlacedLine = {
      y: top + line.baseline,
      top,
      height: line.height,
      blockId,
      extra: line.extra,
      readRank: line.readRank,
      runs: line.runs.map((r) => ({ ...r, x: r.x + L.marginSide })),
    };
    if (line.rule) placed.rule = { y: top + line.height + line.rule.gap + line.rule.w / 2, w: line.rule.w, color: line.rule.color, x1: L.marginSide, x2: PAGE_W - L.marginSide };
    if (line.square) {
      const first = line.runs[0];
      const sz = line.square.size;
      const center = top + line.baseline - first.size * 0.33;
      placed.square = { x: L.marginSide + line.square.x, y: center - sz / 2, size: sz };
    }
    page.lines.push(placed);
    y = top + lineAdvance({ ...line, gapBefore: 0 });
    page.bottomUsed = Math.max(page.bottomUsed, top + line.height);
  };

  const newPage = (firstBlockId: number) => {
    page = { number: pages.length + 1, lines: [], bottomUsed: L.marginTop };
    pages.push(page);
    pageStartBlocks.push(firstBlockId);
    y = L.marginTop;
    const extras = pageExtras(m, L, name, page.number, draft);
    extras.forEach((e) => place(e, -1));
    if (extras.length) y += extrasAfter;
    atTop = true;
    pendingAfter = 0;
  };

  newPage(0);
  // units: a block plus following blocks it must stay with
  const units: BlockSpec[][] = [];
  let curUnit: BlockSpec[] = [];
  blocks.forEach((b, i) => {
    curUnit.push(b);
    if (!(b.keepNext && i < blocks.length - 1)) {
      units.push(curUnit);
      curUnit = [];
    }
  });
  if (curUnit.length) units.push(curUnit);

  const unitHeight = (u: BlockSpec[], firstGap: number) => {
    let h = firstGap;
    u.forEach((b, i) => {
      if (i > 0) h += Math.max(u[i - 1].after, b.before);
      h += blockHeight(b);
    });
    return h;
  };

  for (const u of units) {
    const gap = atTop ? 0 : Math.max(pendingAfter, u[0].before);
    let h = unitHeight(u, gap);
    if (y + h > bottom + 0.01 && !atTop) {
      newPage(u[0].id);
      h = unitHeight(u, 0);
    }
    const startGap = atTop ? 0 : Math.max(pendingAfter, u[0].before);
    y += startGap;
    u.forEach((b, i) => {
      if (i > 0) y += Math.max(u[i - 1].after, b.before);
      // fallback: a block taller than the whole page flows line by line
      for (const line of b.lines) {
        if (y + line.gapBefore + line.height > bottom + 0.01 && !atTop) newPage(b.id);
        place(line, b.id);
        atTop = false;
      }
      pendingAfter = b.after;
    });
    atTop = false;
    void contentH;
  }
  return { level: L, pages, blocks, pageStartBlocks, name, draft };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

function lastPageStats(layout: Layout): { lines: number; fill: number } {
  const last = layout.pages[layout.pages.length - 1];
  const real = last.lines.filter((l) => !l.extra);
  // a line of a block counts once per drawn row
  const contentH = PAGE_H - layout.level.marginBottom - layout.level.marginTop;
  return { lines: real.length, fill: Math.min(1, Math.max(0, (last.bottomUsed - layout.level.marginTop) / contentH)) };
}

export function describeFit(pages: number, spillLines: number, lastPageFill: number): string {
  if (pages <= 1) return "Fits on 1 page";
  if (spillLines <= 8) return `Runs ${spillLines} ${spillLines === 1 ? "line" : "lines"} onto page ${pages}: cut or tighten`;
  if (lastPageFill >= 0.5) return `${pages} full pages`;
  return `${pages} pages`;
}

export function pickLayout(build: (L: Level) => Layout): { layout: Layout; fit: FitInfo } {
  const all = LEVELS.map((L) => build(L));
  const minPages = Math.min(...all.map((l) => l.pages.length));
  const chosen = all.find((l) => l.pages.length === minPages)!;
  const tight = all[all.length - 1];
  const tightest = all.reduce((a, b) => (b.pages.length <= a.pages.length ? b : a), tight);
  const stats = lastPageStats(tightest);
  const pages = chosen.pages.length;
  const spill = pages > 1 ? stats.lines : 0;
  return { layout: chosen, fit: { pages, spillLines: spill, lastPageFill: stats.fill, words: describeFit(pages, spill, stats.fill) } };
}

export function layoutResume(model: ResumeModel, m: Measurer, opts: RenderOptions = {}): { layout: Layout; fit: FitInfo } {
  const draft = !!opts.draft;
  return pickLayout((L) => paginate(m, resumeBlocks(m, model, L), L, model.header.name, draft));
}

export function layoutLetter(model: LetterModel, m: Measurer, opts: RenderOptions = {}): { layout: Layout; fit: FitInfo } {
  const draft = !!opts.draft;
  return pickLayout((L) => paginate(m, letterBlocks(m, model, L), L, model.header.name, draft));
}

/** The to-do page for a DRAFT: not part of the resume, and says so. */
export function layoutChecklist(items: string[], m: Measurer): Layout {
  const L = LEVELS[0];
  const W = PAGE_W - 2 * L.marginSide;
  const blocks: BlockSpec[] = [];
  let id = 0;
  const heading = lineBox(m, "sansBold", 14, 1.25);
  blocks.push({
    id: id++, src: { kind: "header" }, before: 0, after: 8, keepNext: false,
    lines: [{
      runs: [{ text: "YOUR TO-DO LIST", face: "sansBold", size: 14, color: COLORS.accent, x: 0 }],
      height: heading.height, baseline: heading.baseline, gapBefore: 0,
      rule: { gap: 4, w: SHAPE.accentRule, color: COLORS.accent },
    }],
  });
  const intro = "This page is not part of your resume. It lists what is left to fix. Take this page out before you send your resume to anyone.";
  blocks.push({ id: id++, src: { kind: "letter-para", lines: [intro] }, before: 0, after: 8, keepNext: false, lines: textLines(m, intro, "serif", 11, COLORS.ink, W, 1.35) });
  for (const item of items) {
    const lines = textLines(m, item, "serif", 11, COLORS.ink, W - SHAPE.bulletIndent, 1.35, SHAPE.bulletIndent);
    lines[0].square = { x: 1, size: SHAPE.bulletSquare };
    blocks.push({ id: id++, src: { kind: "bullet", text: item }, before: 0, after: 4, keepNext: false, lines });
  }
  return paginate(m, blocks, L, "", true);
}
