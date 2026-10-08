/**
 * Creative lane layouts on the same page model, fonts and look as the resume:
 *
 *  - Artist resume (College Art Association order): years in a left column,
 *    the entry hanging beside them, titles of works and shows in italics,
 *    reverse chronological inside each section. Built from the structured
 *    model core assembles from the practice record; nothing is parsed from
 *    free text and no word is changed here.
 *  - Bio card: the bio's saved lengths one after another, each with its word
 *    and character count (characters counted with spaces, as portals do).
 *
 * Pure: the caller supplies the Measurer (fonts.ts on the server, a fixed
 * width one in tests). PDF, Word and HTML all draw from the Layout this makes.
 */

import { COLORS, PAGE_W, SHAPE, type FaceKey, type Level } from "./style";
import {
  headerBlock,
  lineBox,
  paginate,
  pickLayout,
  textLines,
  type BlockSpec,
  type EntrySrc,
  type FitInfo,
  type Layout,
  type LineSpec,
  type Measurer,
  type Run,
} from "./layout";
import type { ModelHeader } from "./model";
import { plainDashes } from "./model";

/** Width of the years column, points. "2019-2021" fits at 10 pt bold with room. */
export const YEAR_COL = 64;

export interface ArtistResumeInput {
  header: { name: string; discipline: string; contact: string[] };
  sections: { heading: string; rows: { years: string; parts: { text: string; italic?: boolean; after?: string }[] }[] }[];
}

export interface BioCardInput {
  name: string;
  discipline: string;
  bios: { label: string; text: string; words: number; chars: number }[];
}

interface Token {
  text: string;
  face: FaceKey;
  /** A space goes before this token (false for punctuation glued to a word). */
  space: boolean;
}

function tokensOf(parts: EntrySrc["parts"]): Token[] {
  const out: Token[] = [];
  parts.forEach((p, pi) => {
    const face: FaceKey = p.italic ? "serifItalic" : "serif";
    plainDashes(p.text)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((w, wi) => out.push({ text: w, face, space: !(pi === 0 && wi === 0) }));
    if (p.after) out.push({ text: p.after, face: "serif", space: false });
  });
  if (out[0]) out[0].space = false;
  return out;
}

/** Greedy wrap of mixed roman and italic words into lines of runs, x from 0. */
export function wrapParts(m: Measurer, parts: EntrySrc["parts"], size: number, width: number): Run[][] {
  const lines: Run[][] = [[]];
  let x = 0;
  const space = m.width("serif", " ", size);
  for (const t of tokensOf(parts)) {
    const w = m.width(t.face, t.text, size);
    const lead = lines[lines.length - 1].length && t.space ? space : 0;
    if (lines[lines.length - 1].length && x + lead + w > width + 0.01 && t.space) {
      lines.push([]);
      x = 0;
    }
    const cur = lines[lines.length - 1];
    const gap = cur.length && t.space ? space : 0;
    const last = cur[cur.length - 1];
    if (last && last.face === t.face) {
      last.text += (t.space ? " " : "") + t.text;
    } else {
      // A space before a face change belongs to the earlier run (PDF draws runs at x).
      if (last && gap) last.text += " ";
      cur.push({ text: t.text, face: t.face, size, color: COLORS.ink, x: x + gap });
    }
    x += gap + w;
  }
  return lines.filter((l) => l.length);
}

function sectionBlock(m: Measurer, text: string, L: Level, id: number): BlockSpec {
  const box = lineBox(m, "sansBold", SHAPE.headingSize, 1.25);
  return {
    id, src: { kind: "section", text }, before: L.sectionBefore, after: L.sectionAfter, keepNext: true,
    lines: [{
      runs: [{ text, face: "sansBold", size: SHAPE.headingSize, color: COLORS.accent, x: 0 }],
      height: box.height, baseline: box.baseline, gapBefore: 0,
      rule: { gap: 2, w: SHAPE.headingRule, color: COLORS.rule },
    }],
  };
}

function entryBlock(m: Measurer, src: EntrySrc, L: Level, W: number, id: number): BlockSpec {
  const size = L.body;
  const rows = wrapParts(m, src.parts, size, W - YEAR_COL);
  const lines: LineSpec[] = rows.map((runs, i) => {
    const b = lineBox(m, "serif", size, L.lineHeight);
    const shifted = runs.map((r) => ({ ...r, x: r.x + YEAR_COL }));
    const withYears: Run[] = i === 0 && src.years
      ? [{ text: src.years, face: "sansBold", size: SHAPE.metaSize, color: COLORS.ink, x: 0 }, ...shifted]
      : shifted;
    return { runs: withYears, height: b.height, baseline: b.baseline, gapBefore: 0 };
  });
  return { id, src, before: 0, after: L.bulletAfter + 1.5, keepNext: false, lines };
}

function header(name: string, discipline: string, contact: string[]): ModelHeader {
  return { name, headline: discipline, contact: contact.join(" | "), notes: "", order: ["name", "headline", "contact", "notes"] };
}

export function artistBlocks(m: Measurer, model: ArtistResumeInput, L: Level): BlockSpec[] {
  const W = PAGE_W - 2 * L.marginSide;
  const out: BlockSpec[] = [];
  let id = 0;
  const hb = headerBlock(m, header(model.header.name, model.header.discipline, model.header.contact), L, W, id);
  if (hb) {
    out.push(hb);
    id++;
  }
  for (const sec of model.sections) {
    out.push(sectionBlock(m, sec.heading.toUpperCase(), L, id++));
    for (const r of sec.rows) out.push(entryBlock(m, { kind: "entry", years: r.years, parts: r.parts }, L, W, id++));
  }
  return out;
}

export function layoutArtistResume(model: ArtistResumeInput, m: Measurer, opts: { draft?: boolean } = {}): { layout: Layout; fit: FitInfo } {
  return pickLayout((L) => paginate(m, artistBlocks(m, model, L), L, model.header.name, !!opts.draft));
}

export function bioBlocks(m: Measurer, card: BioCardInput, L: Level): BlockSpec[] {
  const W = PAGE_W - 2 * L.marginSide;
  const out: BlockSpec[] = [];
  let id = 0;
  const hb = headerBlock(m, header(card.name, card.discipline, []), L, W, id);
  if (hb) {
    out.push(hb);
    id++;
  }
  for (const b of card.bios) {
    if (!b.text.trim()) continue;
    out.push(sectionBlock(m, b.label.toUpperCase(), L, id++));
    const count = `${b.words} ${b.words === 1 ? "word" : "words"}, ${b.chars} characters with spaces`;
    out.push({
      id: id++, src: { kind: "para", text: count, role: "overview" }, before: 1.5, after: 2, keepNext: true,
      lines: textLines(m, count, "serifItalic", Math.max(10, L.body - 0.25), COLORS.soft, W, L.lineHeight),
    });
    const text = plainDashes(b.text);
    out.push({
      id: id++, src: { kind: "para", text, role: "body" }, before: 0, after: L.paraAfter, keepNext: false,
      lines: textLines(m, text, "serif", L.body, COLORS.ink, W, L.lineHeight),
    });
  }
  return out;
}

export function layoutBioCard(card: BioCardInput, m: Measurer, opts: { draft?: boolean } = {}): { layout: Layout; fit: FitInfo } {
  return pickLayout((L) => paginate(m, bioBlocks(m, card, L), L, card.name, !!opts.draft));
}
