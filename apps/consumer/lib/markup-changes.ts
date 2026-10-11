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

/**
 * The changes this page may show: right shape, `old` found in the person's
 * own text, `new` found in the finished resume, a real change, no repeats,
 * at most MAX_CHANGES. Anything else is dropped without a word.
 */
export function readChanges(raw: unknown, personText: string, finalResume: string): MarkupChange[] {
  if (!Array.isArray(raw)) return [];
  const person = normLine(personText ?? "");
  const final = normLine(finalResume ?? "");
  if (!person || !final) return [];
  const out: MarkupChange[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CHANGES) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const oldLine = normLine(str(r.old));
    const newLine = normLine(str(r.new));
    const why = cleanWhy(str(r.why));
    if (!oldLine || !newLine || !why || oldLine === newLine) continue;
    if (!person.includes(oldLine) || !final.includes(newLine)) continue;
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
  /** Text on the line before and after the changed part (the bullet mark, say). */
  before: string;
  after: string;
  change: MarkupChange;
}

/**
 * Put each change on its line of the page, top to bottom. A change whose old
 * text is not on a single line (or whose line already holds a change) is
 * still shown, after the page, with no line of its own.
 */
export function planReveal(lines: string[], changes: MarkupChange[]): RevealStep[] {
  const normed = lines.map(normLine);
  const used = new Set<number>();
  const placed: RevealStep[] = [];
  const loose: RevealStep[] = [];
  changes.forEach((change, k) => {
    let at = normed.findIndex((l, i) => !used.has(i) && l === change.old);
    if (at < 0) at = normed.findIndex((l, i) => !used.has(i) && l.includes(change.old));
    if (at < 0) {
      loose.push({ id: `loose-${k}`, lineIndex: -1, before: "", after: "", change });
      return;
    }
    used.add(at);
    const l = normed[at];
    const start = l.indexOf(change.old);
    placed.push({
      id: `line-${at}`,
      lineIndex: at,
      before: l.slice(0, start),
      after: l.slice(start + change.old.length),
      change,
    });
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
/** Then the reason sits long enough to read. */
export function readMs(why: string): number {
  return Math.min(4800, Math.max(2200, why.length * 30));
}

/** How many characters of `text` show after `elapsed` ms of typing. */
export function typedChars(text: string, elapsed: number): number {
  if (elapsed <= 0) return 0;
  const per = Math.min(CHAR_MS, TYPE_MAX_MS / Math.max(1, text.length));
  return Math.min(text.length, Math.floor(elapsed / per));
}

/** The whole time one change takes on screen. */
export function stepMs(change: MarkupChange): number {
  return STRIKE_MS + Math.min(TYPE_MAX_MS, change.new.length * CHAR_MS) + readMs(change.why);
}
