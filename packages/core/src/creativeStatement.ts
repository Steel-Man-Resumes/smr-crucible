/**
 * The statement coach and the statement's authorship guard (CR-03). Pure.
 *
 * The artist statement is the person's own. The tool never writes, rewrites
 * or completes a sentence of it. t.ROY may only:
 *   - ask coaching questions (shown beside the text, never inside it);
 *   - read the draft back as questions (a very long sentence, a vague word);
 *   - offer spelling marks, which the person accepts ONE AT A TIME.
 *
 * Three walls keep model text out of the saved statement:
 *   1. parseCoachOutput keeps only questions and single-word spelling marks
 *      from whatever a model returns. Prose, rewrites and "here is a stronger
 *      version" are dropped before anything reaches the screen.
 *   2. Every coach call stores fingerprints of the model's RAW reply (hashed
 *      five-word runs). checkStatementSave refuses a save that adds any
 *      five-word run the model wrote, even if the text somehow reached the
 *      page.
 *   3. An accepted spelling mark is checked as exactly one word swapped for
 *      the word t.ROY offered, a close spelling of it, and nothing else.
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
 * question, and none suggests a word for them to use.
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
  /** The word as it appears in the person's text. */
  word: string;
  /** The spelling t.ROY offers. One word. */
  suggestion: string;
}

const WORD_RE = /^[A-Za-z][A-Za-z'’]{0,29}$/;

/** Common misspellings. A small fixed list, so marks work with no model at all. */
const COMMON_MISSPELLINGS: Record<string, string> = {
  acheive: "achieve", accross: "across", alot: "a", begining: "beginning", beleive: "believe", belive: "believe",
  becuase: "because", calender: "calendar", comittee: "committee", completly: "completely", concious: "conscious",
  definately: "definitely", dissapear: "disappear", enviroment: "environment", existance: "existence",
  experiance: "experience", familar: "familiar", finaly: "finally", foriegn: "foreign", freind: "friend",
  goverment: "government", happend: "happened", immediatly: "immediately", independant: "independent",
  knowlege: "knowledge", libary: "library", neccessary: "necessary", noticable: "noticeable", occured: "occurred",
  occurence: "occurrence", peice: "piece", persue: "pursue", posession: "possession", recieve: "receive",
  remeber: "remember", seperate: "separate", sucess: "success", suprise: "surprise", thier: "their",
  tommorow: "tomorrow", truely: "truly", untill: "until", wich: "which", wierd: "weird", writting: "writing",
  paintting: "painting", sculpure: "sculpture", portrat: "portrait", inspriation: "inspiration",
};

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

/**
 * Is this a spelling fix and nothing more? One word in, one word out, a close
 * spelling (edit distance 1 or 2, 3 for long words), never the same word.
 */
export function isSpellingFix(word: string, suggestion: string): boolean {
  if (!WORD_RE.test(word) || !WORD_RE.test(suggestion)) return false;
  const a = word.toLowerCase();
  const b = suggestion.toLowerCase();
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  const limit = Math.max(a.length, b.length) >= 9 ? 3 : 2;
  return editDistance(a, b) <= limit;
}

/** Keep the person's capital letter when the word started with one. */
function matchCase(word: string, suggestion: string): string {
  return /^[A-Z]/.test(word) ? suggestion[0].toUpperCase() + suggestion.slice(1) : suggestion;
}

/** Words of the text (letters and apostrophes), in order. */
function wordsOf(text: string): string[] {
  return (text ?? "").match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
}

/** Spelling marks from the fixed list. */
export function dictionaryMarks(text: string): SpellingMark[] {
  const out: SpellingMark[] = [];
  for (const w of wordsOf(text)) {
    const fix = COMMON_MISSPELLINGS[w.toLowerCase()];
    if (fix && fix.length > 1 && isSpellingFix(w, fix) && !out.some((m) => m.word === w)) {
      out.push({ word: w, suggestion: matchCase(w, fix) });
    }
  }
  return out;
}

// ------------------------------------------------- what a model may return --

export interface CoachOutput {
  questions: string[];
  marks: SpellingMark[];
}

const MAX_MODEL_QUESTIONS = 3;
const QUESTION_MAX = 200;

/**
 * Read a model reply for the coach. Expected JSON:
 *   { "questions": ["...?"], "spelling": [{ "word": "...", "suggestion": "..." }] }
 * Anything else in the reply is thrown away. A "question" must be one
 * sentence ending in "?", short, and must not carry a run of five or more of
 * the person's own words back with changes (a disguised rewrite). A spelling
 * mark must name a word that is in the person's text and pass isSpellingFix.
 */
export function parseCoachOutput(raw: string, personText: string): CoachOutput {
  let data: unknown = null;
  const m = (raw ?? "").match(/\{[\s\S]*\}/);
  if (m) {
    try {
      data = JSON.parse(m[0]);
    } catch {
      data = null;
    }
  }
  const obj = (data && typeof data === "object" ? data : {}) as { questions?: unknown; spelling?: unknown };
  const personWords = new Set(wordsOf(personText));

  const questions: string[] = [];
  if (Array.isArray(obj.questions)) {
    for (const q of obj.questions) {
      if (typeof q !== "string") continue;
      const t = q.replace(/\s+/g, " ").trim();
      if (!t || t.length > QUESTION_MAX || !t.endsWith("?")) continue;
      // One sentence only: no full stop or "!" before the closing "?".
      if (/[.!]\s/.test(t.slice(0, -1))) continue;
      // No dashes the house never prints.
      if (/[\u2013\u2014]/.test(t)) continue;
      questions.push(t);
      if (questions.length >= MAX_MODEL_QUESTIONS) break;
    }
  }

  const marks: SpellingMark[] = [];
  if (Array.isArray(obj.spelling)) {
    for (const s of obj.spelling) {
      const w = (s as { word?: unknown })?.word;
      const sug = (s as { suggestion?: unknown })?.suggestion;
      if (typeof w !== "string" || typeof sug !== "string") continue;
      if (!personWords.has(w)) continue;
      if (!isSpellingFix(w, sug)) continue;
      if (marks.some((x) => x.word === w)) continue;
      marks.push({ word: w, suggestion: sug });
      if (marks.length >= 20) break;
    }
  }
  return { questions, marks };
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

/**
 * Hashed five-word runs of a model reply, to keep with the statement. Runs
 * that were already in the person's text sent to the coach are left out: a
 * model quoting the person back does not make their own words model text.
 */
export function modelFingerprints(raw: string, personText = ""): string[] {
  const own = new Set(shinglesOf(personText));
  return Array.from(new Set(shinglesOf(raw).filter((s) => !own.has(s)).map(fnv1a))).slice(0, 2000);
}

// -------------------------------------------------------------- the guard --

export interface StatementSaveInput {
  /** The last saved statement (the person's own text so far), or "". */
  previousText: string;
  /** The text the save would store. */
  nextText: string;
  /** Present when the save is ONE accepted spelling mark. */
  acceptedMark?: SpellingMark | null;
  /** Marks t.ROY actually offered on this statement. */
  offeredMarks: SpellingMark[];
  /** Fingerprints of every model reply the coach received for this statement. */
  modelPrints: string[];
}

export type StatementSaveResult =
  | { ok: true }
  | { ok: false; reason: "model_text" | "mark_not_offered" | "mark_not_spelling" | "mark_changed_more" | "too_long" };

export const STATEMENT_MAX_CHARS = 12000;

/**
 * Can this text be saved as the person's statement?
 *
 * A typed save: allowed, unless it adds a five-word run that matches any
 * model reply the coach saw (wall 2). Runs already in the previous text are
 * the person's own and stay allowed.
 *
 * A spelling-mark save: the new text must be the previous text with exactly
 * one occurrence of the offered word swapped for its offered spelling, and no
 * other change (wall 3).
 */
export function checkStatementSave(inp: StatementSaveInput): StatementSaveResult {
  const next = inp.nextText ?? "";
  const prev = inp.previousText ?? "";
  if (Array.from(next).length > STATEMENT_MAX_CHARS) return { ok: false, reason: "too_long" };

  if (inp.acceptedMark) {
    const mk = inp.acceptedMark;
    const offered = inp.offeredMarks.some((o) => o.word === mk.word && o.suggestion === mk.suggestion);
    if (!offered) return { ok: false, reason: "mark_not_offered" };
    if (!isSpellingFix(mk.word, mk.suggestion)) return { ok: false, reason: "mark_not_spelling" };
    if (!isOneWordSwap(prev, next, mk)) return { ok: false, reason: "mark_changed_more" };
    return { ok: true };
  }

  const prints = new Set(inp.modelPrints);
  if (prints.size) {
    const own = new Set(shinglesOf(prev));
    for (const sh of shinglesOf(next)) {
      if (own.has(sh)) continue;
      if (prints.has(fnv1a(sh))) return { ok: false, reason: "model_text" };
    }
  }
  return { ok: true };
}

/** Is `next` exactly `prev` with one whole-word `mark.word` replaced by `mark.suggestion`? */
export function isOneWordSwap(prev: string, next: string, mark: SpellingMark): boolean {
  const re = new RegExp(`(?<![A-Za-z'’])${mark.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z'’])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(prev))) {
    const candidate = prev.slice(0, m.index) + mark.suggestion + prev.slice(m.index + mark.word.length);
    if (candidate === next) return true;
  }
  return false;
}

/** Apply one accepted mark to the first matching whole word. Returns the text unchanged if absent. */
export function applySpellingMark(text: string, mark: SpellingMark): string {
  const re = new RegExp(`(?<![A-Za-z'’])${mark.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z'’])`);
  const m = re.exec(text);
  return m ? text.slice(0, m.index) + mark.suggestion + text.slice(m.index + mark.word.length) : text;
}

export const STATEMENT_SAVE_COPY: Record<Exclude<StatementSaveResult, { ok: true }>["reason"], string> = {
  model_text: "That text matches words t.ROY wrote. Your statement has to be in your own words. Take that part out and write it your way.",
  mark_not_offered: "That spelling change wasn't one t.ROY offered. Type the change yourself instead.",
  mark_not_spelling: "That isn't a spelling fix. Type the change yourself instead.",
  mark_changed_more: "Only the one word can change when you accept a spelling mark. Save your other edits first.",
  too_long: "That's longer than any application allows. Trim it before you save.",
};

// ------------------------------------------------------------- versions --

export interface StatementVersion {
  text: string;
  savedAt: string;
  /** "typed" by the person, or one accepted "spelling" mark. */
  via: "typed" | "spelling";
  /** The mark accepted, for a "spelling" version. */
  mark?: SpellingMark;
}

/** Fingerprints of one coach reply, with when it came back. */
export interface ModelPrintSet {
  at: string;
  prints: string[];
}

export const MAX_STATEMENT_VERSIONS = 25;
export const MAX_MODEL_PRINT_SETS = 10;

/** What a statement artifact holds. Only the versions are ever shown as the statement. */
export interface StatementContent {
  versions: StatementVersion[];
  /** Marks offered by t.ROY (so an acceptance can be checked). */
  offeredMarks: SpellingMark[];
  /** Fingerprints of model replies, newest last. */
  modelPrints: ModelPrintSet[];
}

export function emptyStatement(): StatementContent {
  return { versions: [], offeredMarks: [], modelPrints: [] };
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
  const offeredMarks = Array.isArray(c.offeredMarks)
    ? c.offeredMarks.filter((m): m is SpellingMark => !!m && typeof m.word === "string" && typeof m.suggestion === "string")
    : [];
  const modelPrints = Array.isArray(c.modelPrints)
    ? c.modelPrints
        .filter((p): p is ModelPrintSet => !!p && typeof p.at === "string" && Array.isArray(p.prints))
        .map((p) => ({ at: p.at, prints: p.prints.filter((x) => typeof x === "string") }))
    : [];
  return { versions, offeredMarks, modelPrints };
}

/** Every fingerprint from coach replies that came back before `iso` (all of them when absent). */
export function printsBefore(c: StatementContent, iso?: string): string[] {
  const out: string[] = [];
  for (const set of c.modelPrints) if (!iso || set.at <= iso) out.push(...set.prints);
  return out;
}

/**
 * Re-check the whole saved history (CR-03): every version, against the one
 * before it and every coach reply that existed when it was saved. Returns the
 * first version that fails, or null when all of it is the person's own.
 */
export function auditStatementHistory(c: StatementContent): { index: number; reason: string } | null {
  let prev = "";
  for (let i = 0; i < c.versions.length; i++) {
    const v = c.versions[i];
    const r = checkStatementSave({
      previousText: prev,
      nextText: v.text,
      acceptedMark: v.via === "spelling" ? v.mark ?? { word: "", suggestion: "" } : null,
      offeredMarks: c.offeredMarks,
      modelPrints: printsBefore(c, v.savedAt),
    });
    if (!r.ok) return { index: i, reason: r.reason };
    prev = v.text;
  }
  return null;
}

export function currentStatementText(c: StatementContent): string {
  return c.versions.length ? c.versions[c.versions.length - 1].text : "";
}
