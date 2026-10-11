/**
 * The live fix on the finish page: the writer's real `changes`, made safe to
 * show and placed on the person's own page.
 *
 * Contract (Phase 6, lane S2 emits it from /api/forge/generate-docs):
 *   changes: Array<{ old: string; new: string; why: string; rule: string }>
 * `old` is a line from the person's resume text, `new` the line it became in
 * the FINAL resume (after the truth check), `why` one plain t.ROY sentence.
 * Missing or empty means no reveal, never an error.
 *
 * The server already keeps only verified entries. This module checks again
 * against the exact text this page holds, so a line that is not in the
 * finished resume is never typed on screen (nothing appears that later
 * disappears).
 *
 * Pure: no I/O, no React.
 */

export interface MarkupChange {
  old: string;
  new: string;
  why: string;
  rule: string;
}

export const MAX_CHANGES = 40;

/** Whitespace-normalized, as the server compares. */
export const normLine = (s: string) => s.replace(/\s+/g, " ").trim();

// The writer's why is shown as is, except long dashes (house style for
// anything a job seeker reads): a comma reads the same.
const cleanWhy = (s: string) => normLine(s).replace(/\s*(?:[\u2013\u2014]|-{2})\s*/g, ", ");

const str = (v: unknown) => (typeof v === "string" ? v : "");

// A bullet mark at the start of a line: the only text allowed around a change.
const BULLET_MARK_RE = /^[-*\u2022\u00b7\u25aa\u25cf\u25e6\u2023\u2013\u2014]\s*/;
/** A line without its bullet mark, whitespace-normalized. */
export const lineBody = (s: string) => normLine(s).replace(BULLET_MARK_RE, "").trim();

/** The whole lines of a text, bullet marks off, as a set. */
function wholeLines(text: string): Set<string> {
  return new Set(text.replace(/\r\n?/g, "\n").split("\n").map(lineBody).filter(Boolean));
}

/**
 * The changes this page may show: right shape, `old` is a whole line of the
 * person's own text, `new` is a whole line of the finished resume (bullet
 * marks aside), a real change, no repeats, at most MAX_CHANGES. Anything else
 * is dropped without a word. Whole lines only, so nothing can be typed that
 * sits on neither page.
 */
export function readChanges(raw: unknown, personText: string, finalResume: string): MarkupChange[] {
  if (!Array.isArray(raw)) return [];
  const person = wholeLines(personText ?? "");
  const final = wholeLines(finalResume ?? "");
  if (!person.size || !final.size) return [];
  const out: MarkupChange[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CHANGES) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const oldLine = lineBody(str(r.old));
    const newLine = lineBody(str(r.new));
    const why = cleanWhy(str(r.why));
    if (!oldLine || !newLine || !why || oldLine === newLine) continue;
    if (!person.has(oldLine) || !final.has(newLine)) continue;
    if (seen.has(oldLine)) continue;
    seen.add(oldLine);
    out.push({ old: oldLine, new: newLine, why, rule: normLine(str(r.rule)).slice(0, 40) });
  }
  return out;
}

export interface RevealStep {
  id: string;
  /** Index into the page lines, or -1 when the change could not be placed on one line. */
  lineIndex: number;
  /** The bullet mark in front of the line, or "". */
  before: string;
  /** Always "" now (whole lines only); kept for the renderer. */
  after: string;
  change: MarkupChange;
}

/**
 * Put each change on its line of the page, top to bottom. A change matches a
 * line only as the whole line (its bullet mark aside). One that matches no
 * free line is still shown, after the page, with no line of its own.
 */
export function planReveal(lines: string[], changes: MarkupChange[]): RevealStep[] {
  const bodies = lines.map(lineBody);
  const used = new Set<number>();
  const placed: RevealStep[] = [];
  const loose: RevealStep[] = [];
  changes.forEach((change, k) => {
    const at = bodies.findIndex((b, i) => !used.has(i) && b === change.old);
    if (at < 0) {
      loose.push({ id: `loose-${k}`, lineIndex: -1, before: "", after: "", change });
      return;
    }
    used.add(at);
    const mark = normLine(lines[at]).match(BULLET_MARK_RE)?.[0] ?? "";
    placed.push({ id: `line-${at}`, lineIndex: at, before: mark, after: "", change });
  });
  placed.sort((a, b) => a.lineIndex - b.lineIndex);
  return [...placed, ...loose];
}

// ---- Pace ----------------------------------------------------------------------

/** The old line gets struck through. */
export const STRIKE_MS = 700;
/** Then the new line types in, a character at a time... */
export const CHAR_MS = 28;
/** ...but never longer than this. */
export const TYPE_MAX_MS = 1800;
/** A whole replay aims to fit in about this long; many changes play faster. */
export const REPLAY_BUDGET_MS = 75_000;
/** Floors, so even a fast change can be read. */
const MIN_STRIKE_MS = 250;
const MIN_TYPE_MS = 300;
const MIN_READ_MS = 1300;

/** How long the reason sits at full pace. */
export function readMs(why: string): number {
  return Math.min(4800, Math.max(2200, why.length * 30));
}

export interface StepPace {
  strike: number;
  type: number;
  read: number;
  total: number;
}

const fullPace = (c: MarkupChange): StepPace => {
  const strike = STRIKE_MS;
  const type = Math.min(TYPE_MAX_MS, c.new.length * CHAR_MS);
  const read = readMs(c.why);
  return { strike, type, read, total: strike + type + read };
};

/**
 * The pace for each change. Full pace when the whole replay fits the budget;
 * otherwise every phase is scaled down (never below the floors), so even
 * forty changes finish in about a minute and a half.
 */
export function paceFor(changes: MarkupChange[]): StepPace[] {
  const full = changes.map(fullPace);
  const sum = full.reduce((a, p) => a + p.total, 0);
  const f = sum > REPLAY_BUDGET_MS ? REPLAY_BUDGET_MS / sum : 1;
  return full.map((p) => {
    if (f === 1) return p;
    const strike = Math.max(MIN_STRIKE_MS, Math.round(p.strike * f));
    const type = Math.max(MIN_TYPE_MS, Math.round(p.type * f));
    const read = Math.max(MIN_READ_MS, Math.round(p.read * f));
    return { strike, type, read, total: strike + type + read };
  });
}

/** How many characters of `text` show after `elapsed` ms of a `duration` ms typing phase. */
export function typedChars(text: string, elapsed: number, duration: number = Math.min(TYPE_MAX_MS, text.length * CHAR_MS)): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return text.length;
  return Math.min(text.length, Math.floor((elapsed / Math.max(1, duration)) * text.length));
}

/** The whole time one change takes on screen at full pace. */
export function stepMs(change: MarkupChange): number {
  return fullPace(change).total;
}
