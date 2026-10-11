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
/** At most this many changes play; the rest are in the list under the page. */
export const REPLAY_MAX = 12;
/** Each played change stays on screen at least this long, typing included. */
export const MIN_STEP_MS = 4000;

/** How long the reason sits. */
export function readMs(why: string): number {
  return Math.min(4800, Math.max(2200, why.length * 30));
}

export interface StepPace {
  strike: number;
  type: number;
  read: number;
  total: number;
}

/**
 * The pace for each played change: always the readable pace (never squeezed),
 * and never under MIN_STEP_MS. With REPLAY_MAX changes at most, the whole
 * replay stays under about ninety seconds.
 */
export function paceFor(changes: MarkupChange[]): StepPace[] {
  return changes.map((c) => {
    const strike = STRIKE_MS;
    const type = Math.min(TYPE_MAX_MS, c.new.length * CHAR_MS);
    const read = Math.max(readMs(c.why), MIN_STEP_MS - strike - type);
    return { strike, type, read, total: strike + type + read };
  });
}

/**
 * Which changes play: one of each kind first (so the replay shows every kind
 * of fix), then the rest in page order, up to `max`, shown top to bottom.
 */
export function pickForReplay<T extends { change: MarkupChange }>(steps: T[], max: number = REPLAY_MAX): T[] {
  if (steps.length <= max) return steps;
  const chosen = new Set<number>();
  const kinds = new Set<string>();
  steps.forEach((s, k) => {
    if (chosen.size >= max) return;
    const kind = s.change.rule || "other";
    if (kinds.has(kind)) return;
    kinds.add(kind);
    chosen.add(k);
  });
  for (let k = 0; k < steps.length && chosen.size < max; k++) chosen.add(k);
  return steps.filter((_, k) => chosen.has(k));
}

/** How many characters of `text` show after `elapsed` ms of a `duration` ms typing phase. */
export function typedChars(text: string, elapsed: number, duration: number = Math.min(TYPE_MAX_MS, text.length * CHAR_MS)): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return text.length;
  return Math.min(text.length, Math.floor((elapsed / Math.max(1, duration)) * text.length));
}

/** The whole time one change takes on screen. */
export function stepMs(change: MarkupChange): number {
  return paceFor([change])[0].total;
}
