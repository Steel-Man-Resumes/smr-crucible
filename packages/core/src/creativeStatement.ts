/**
 * The statement coach and the statement's authorship guard (CR-03). Pure, and
 * safe in the browser (the word list lives in creativeSpelling.ts, server
 * only).
 *
 * The artist statement is the person's own. The tool never writes, rewrites
 * or completes any of it. In v1 the coach is entirely fixed code, and no
 * model ever sees or answers the statement:
 *   - a fixed bank of coaching questions (COACH_QUESTIONS);
 *   - a read-back of the person's OWN sentences as questions (a very long
 *     sentence, a vague word), quoting nothing but their words;
 *   - spelling marks from a word list: only a token that is not a word can be
 *     marked, only with the one closest dictionary word, and the person
 *     accepts each mark on its own.
 *
 * Because nothing a model writes exists, there is no model text to keep out.
 * The save guard below still refuses any five-word run from a stored model
 * reply (a backstop for any future path), and checks every accepted mark as
 * exactly one swapped word that the spelling module itself would offer.
 */

// ------------------------------------------------------------- questions --

/** What arts panels ask a statement to cover, as questions. Fixed, no model. */
export const COACH_QUESTIONS: string[] = [
  "What do you make, and what is it made of?",
  "Where do your ideas come from?",
  "What do you keep coming back to in your work?",
  "How do you make it, step by step?",
  "Who or what has shaped how you work?",
  "What from your own life shows up in the work, if anything?",
  "What do you want someone to notice first?",
];

const VAGUE_WORDS = ["things", "stuff", "various", "etc", "somehow", "something", "very", "really"];
export const LONG_SENTENCE_WORDS = 35;

function sentencesOf(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The read-back: questions about the person's own draft. Every one is a
 * question built from fixed wording plus the person's own words; none
 * suggests a word for them to use.
 */
export function readBackQuestions(text: string): string[] {
  const out: string[] = [];
  for (const s of sentencesOf(text)) {
    const n = s.split(/\s+/).filter(Boolean).length;
    if (n > LONG_SENTENCE_WORDS) {
      const start = s.split(/\s+/).slice(0, 5).join(" ");
      out.push(`The sentence that starts "${start}" runs ${n} words. Is there a place to stop and start a new one?`);
    }
  }
  const lower = ` ${(text ?? "").toLowerCase().replace(/[^a-z' ]+/g, " ")} `;
  for (const w of VAGUE_WORDS) {
    if (lower.includes(` ${w} `)) out.push(`When you say "${w}", what do you mean exactly?`);
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------- spelling marks --

export interface SpellingMark {
  /** The word as it appears in the person's text. Never a dictionary word. */
  word: string;
  /** The one dictionary word offered. */
  suggestion: string;
  /** The person's sentence the word sits in, shown with the mark. */
  sentence?: string;
}

/** Edit distance with adjacent swaps (Damerau, optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

const WORD_CHARS = "A-Za-z'’";

/** Is `next` exactly `prev` with one whole-word `mark.word` replaced by `mark.suggestion`? */
export function isOneWordSwap(prev: string, next: string, mark: SpellingMark): boolean {
  const re = new RegExp(`(?<![${WORD_CHARS}])${mark.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![${WORD_CHARS}])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(prev))) {
    const candidate = prev.slice(0, m.index) + mark.suggestion + prev.slice(m.index + mark.word.length);
    if (candidate === next) return true;
  }
  return false;
}

/** Apply one accepted mark to the first matching whole word. Returns the text unchanged if absent. */
export function applySpellingMark(text: string, mark: SpellingMark): string {
  const re = new RegExp(`(?<![${WORD_CHARS}])${mark.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![${WORD_CHARS}])`);
  const m = re.exec(text);
  return m ? text.slice(0, m.index) + mark.suggestion + text.slice(m.index + mark.word.length) : text;
}

// ------------------------------------------------------------ fingerprints --

/** 32-bit FNV-1a, hex. Enough to recognise a run of words; not a secret. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const SHINGLE_WORDS = 5;

function normWords(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

/** Every run of five words in the text, normalised. */
export function shinglesOf(text: string): string[] {
  const w = normWords(text);
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= w.length; i++) out.push(w.slice(i, i + SHINGLE_WORDS).join(" "));
  return out;
}

/** Hashed five-word runs of a model reply (for the backstop). v1 stores none. */
export function modelFingerprints(raw: string): string[] {
  return Array.from(new Set(shinglesOf(raw).map(fnv1a))).slice(0, 4000);
}

// -------------------------------------------------------------- the guard --

export interface StatementSaveInput {
  /** The last saved statement (the person's own text so far), or "". */
  previousText: string;
  /** The text the save would store. */
  nextText: string;
  /** Present when the save is ONE accepted spelling mark. */
  acceptedMark?: SpellingMark | null;
  /**
   * The server's mark check (creativeSpelling.isValidSpellingMark). Without
   * it no mark can be accepted: the browser can never vouch for a mark.
   */
  validMark?: (m: SpellingMark) => boolean;
  /** Fingerprints of any stored model reply (none in v1). The backstop. */
  modelPrints: string[];
}

export type StatementSaveResult =
  | { ok: true }
  | { ok: false; reason: "model_text" | "mark_not_valid" | "mark_changed_more" | "too_long" };

export const STATEMENT_MAX_CHARS = 12000;

/**
 * Can this text be saved as the person's statement?
 * A typed save: allowed (the person's own words), unless it adds a
 * five-word run of a stored model reply (the backstop). A spelling save: the
 * mark must be exactly the one the spelling module offers for that token,
 * and the new text must be the previous text with that one word swapped.
 */
export function checkStatementSave(inp: StatementSaveInput): StatementSaveResult {
  const next = inp.nextText ?? "";
  const prev = inp.previousText ?? "";
  if (Array.from(next).length > STATEMENT_MAX_CHARS) return { ok: false, reason: "too_long" };

  if (inp.acceptedMark) {
    const mk = inp.acceptedMark;
    if (!inp.validMark || !inp.validMark(mk)) return { ok: false, reason: "mark_not_valid" };
    if (!isOneWordSwap(prev, next, mk)) return { ok: false, reason: "mark_changed_more" };
    return { ok: true };
  }

  if (modelTextAdded(prev, next, inp.modelPrints)) return { ok: false, reason: "model_text" };
  return { ok: true };
}

/** Does `next` add a five-word run (not already in `prev`) that matches a model print? */
function modelTextAdded(prev: string, next: string, prints: string[]): boolean {
  if (!prints.length) return false;
  const set = new Set(prints);
  const own = new Set(shinglesOf(prev));
  return shinglesOf(next).some((sh) => !own.has(sh) && set.has(fnv1a(sh)));
}

export const STATEMENT_SAVE_COPY: Record<Exclude<StatementSaveResult, { ok: true }>["reason"], string> = {
  model_text: "That text matches words t.ROY wrote. Your statement has to be in your own words. Take that part out and write it your way.",
  mark_not_valid: "That isn't a spelling fix t.ROY can make. Type the change yourself instead.",
  mark_changed_more: "Only the one word can change when you accept a spelling fix. Save your other edits first.",
  too_long: "That's longer than any application allows. Trim it before you save.",
};

// ------------------------------------------------------------- versions --

export interface StatementVersion {
  text: string;
  savedAt: string;
  /** "typed" by the person, or one accepted "spelling" fix. */
  via: "typed" | "spelling";
  /** The fix accepted, for a "spelling" version. */
  mark?: { word: string; suggestion: string };
}

/** Fingerprints of one model reply, with when it came back. v1 writes none. */
export interface ModelPrintSet {
  at: string;
  prints: string[];
}

export const MAX_STATEMENT_VERSIONS = 25;

/** What a statement artifact holds. Only the versions are ever shown as the statement. */
export interface StatementContent {
  versions: StatementVersion[];
  /** Kept for life when present (never aged out). v1 never adds any. */
  modelPrints: ModelPrintSet[];
}

export function emptyStatement(): StatementContent {
  return { versions: [], modelPrints: [] };
}

/** Read a stored statement safely (old or odd rows read as empty). */
export function readStatement(content: unknown): StatementContent {
  const c = (content && typeof content === "object" ? content : {}) as Partial<StatementContent>;
  const versions = Array.isArray(c.versions)
    ? c.versions
        .filter((v): v is StatementVersion => !!v && typeof v.text === "string" && typeof v.savedAt === "string")
        .map((v): StatementVersion => ({
          text: v.text,
          savedAt: v.savedAt,
          via: v.via === "spelling" ? "spelling" : "typed",
          ...(v.mark && typeof v.mark.word === "string" && typeof v.mark.suggestion === "string" ? { mark: { word: v.mark.word, suggestion: v.mark.suggestion } } : {}),
        }))
    : [];
  const modelPrints = Array.isArray(c.modelPrints)
    ? c.modelPrints
        .filter((p): p is ModelPrintSet => !!p && typeof p.at === "string" && Array.isArray(p.prints))
        .map((p) => ({ at: p.at, prints: p.prints.filter((x) => typeof x === "string") }))
    : [];
  return { versions, modelPrints };
}

/** Every stored model fingerprint (none in v1). */
export function allPrints(c: StatementContent): string[] {
  return c.modelPrints.flatMap((p) => p.prints);
}

/**
 * Re-check the saved history (CR-03) against model text only: does any kept
 * version contain a five-word run of a stored model reply? Spelling fixes
 * were checked when they were saved and are not re-derived here, so trimming
 * old versions can never raise a false BLOCK. With no model text stored (v1),
 * this is always null.
 */
export function auditStatementHistory(c: StatementContent): { index: number; reason: "model_text" } | null {
  const prints = allPrints(c);
  if (!prints.length) return null;
  for (let i = 0; i < c.versions.length; i++) {
    if (modelTextAdded("", c.versions[i].text, prints)) return { index: i, reason: "model_text" };
  }
  return null;
}

export function currentStatementText(c: StatementContent): string {
  return c.versions.length ? c.versions[c.versions.length - 1].text : "";
}
