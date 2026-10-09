/**
 * Spelling marks for the statement coach. Server only: it loads the bundled
 * word list (spellingWords.ts). Screens import nothing from here.
 *
 * Strict by design. A mark may:
 *   - replace ONLY a token that is not a dictionary word (so a real word,
 *     "not", "paint", "draw", is never touched);
 *   - replace it ONLY with a dictionary word within a small edit distance
 *     (1, or 2 for words of 7 letters or more), starting with the same letter;
 *   - be offered ONLY when exactly one dictionary word is closest. Two words
 *     at the same distance: no mark at all (no guessing which one was meant).
 * A token that looks like a contraction typed without its apostrophe, or
 * misspelled ("hasnt", "havnt", "dosent", "didn"), is never marked: the
 * nearest word would drop the "not". A token ending in "nt" or starting with
 * "nev" only gets a fix that keeps that shape.
 * Names, capitalised words, words with an apostrophe, numbers and very short
 * tokens are never marked. Negation and modal words are never produced.
 */

import { SPELLING_WORDS_BY_LEVEL } from "./spellingWords";
import type { SpellingMark } from "./creativeStatement";

/** Art words the general list leaves out. Lowercase. Ours, not SCOWL's. */
const SUPPLEMENT = [
  "linocut", "linocuts", "printmaker", "printmakers", "woodcut", "woodcuts", "screenprint", "screenprints",
  "screenprinting", "risograph", "zines", "muralist", "muralists", "giclee", "monoprint", "monoprints",
  "letterpress", "spoken", "artworks", "ceramicist", "beadwork", "quilter", "quilters",
];

/** Never produced by a mark and never replaced: words that flip meaning. */
const PROTECTED = new Set([
  "not", "no", "now", "never", "ever", "nor", "none", "can", "cannot", "cant", "won", "wont", "want", "will",
  "would", "should", "could", "must", "may", "might", "shall", "did", "didnt", "dont", "do", "does", "isnt",
  "wasnt", "was", "were", "is", "am", "are", "be", "been", "have", "has", "had", "hate", "love", "live", "lie",
]);

/** Contractions people type without the apostrophe. Never marked. */
const BARE_CONTRACTIONS = new Set([
  "aint", "arent", "cant", "couldnt", "darent", "didnt", "doesnt", "dont", "hadnt", "hasnt", "havent", "isnt",
  "mightnt", "mustnt", "neednt", "oughtnt", "shant", "shouldnt", "wasnt", "werent", "wont", "wouldnt",
  "im", "ive", "id", "youre", "youve", "theyre", "theyve", "weve", "hes", "shes", "itll", "thats", "whats", "lets",
]);

/** Helper verbs a misspelled contraction is built on ("havnt", "dosent", "wernt", "didn"). */
const AUXILIARIES = ["do", "does", "did", "have", "has", "had", "could", "should", "would", "were", "was", "is", "are", "can", "wo", "ai", "must", "need", "might", "dare", "ought"];

/**
 * Does this look like a contraction typed without (or with a wrong) apostrophe?
 * Ends in "nt" or "ent" (or a bare "n") on top of something within one letter
 * of a helper verb. Those are never marked: any near word drops the "not".
 */
export function looksLikeContraction(token: string): boolean {
  const stems: string[] = [];
  if (token.endsWith("ent")) stems.push(token.slice(0, -3));
  if (token.endsWith("nt")) stems.push(token.slice(0, -2));
  if (token.endsWith("n")) stems.push(token.slice(0, -1));
  return stems.some((st) => st.length >= 1 && AUXILIARIES.some((a) => boundedDistance(st, a, 1) <= 1));
}

/** Most distinct non-words one check looks at. A longer list is cut, and the screen says so. */
export const MAX_SPELLING_TOKENS = 150;

/** Known misspellings with their one fix. Checked against the list like any mark. */
const COMMON_MISSPELLINGS: Record<string, string> = {
  acheive: "achieve", accross: "across", begining: "beginning", beleive: "believe", belive: "believe",
  becuase: "because", calender: "calendar", comittee: "committee", completly: "completely", concious: "conscious",
  definately: "definitely", dissapear: "disappear", enviroment: "environment", existance: "existence",
  experiance: "experience", familar: "familiar", finaly: "finally", foriegn: "foreign", freind: "friend",
  goverment: "government", happend: "happened", immediatly: "immediately", independant: "independent",
  knowlege: "knowledge", libary: "library", neccessary: "necessary", noticable: "noticeable", occured: "occurred",
  occurence: "occurrence", peice: "piece", persue: "pursue", posession: "possession", recieve: "receive",
  remeber: "remember", seperate: "separate", sucess: "success", suprise: "surprise", thier: "their",
  tommorow: "tomorrow", truely: "truly", untill: "until", wich: "which", wierd: "weird", writting: "writing",
  paintting: "painting", sculpure: "sculpture", portrat: "portrait", inspriation: "inspiration", teh: "the",
};

let dict: Set<string> | null = null;
let byKey: Map<string, number[]> | null = null;
let words: string[] = [];
/** Letter counts per word (26 bytes each): a cheap lower bound that skips most distance work. */
let bags: Uint8Array = new Uint8Array(0);

function load(): void {
  if (dict) return;
  dict = new Set();
  for (const list of Object.values(SPELLING_WORDS_BY_LEVEL)) for (const w of list.split(" ")) dict.add(w);
  for (const w of SUPPLEMENT) dict.add(w);
  byKey = new Map();
  words = Array.from(dict);
  bags = new Uint8Array(words.length * 26);
  words.forEach((w, idx) => {
    for (let i = 0; i < w.length; i++) {
      const c = w.charCodeAt(i) - 97;
      if (c >= 0 && c < 26) bags[idx * 26 + c]++;
    }
    const k = `${w[0]}${w.length}`;
    const list = byKey!.get(k);
    if (list) list.push(idx);
    else byKey!.set(k, [idx]);
  });
}

export function isDictionaryWord(word: string): boolean {
  load();
  return dict!.has(word.toLowerCase());
}

/** A token the coach is allowed to look at: lowercase letters only, 3 to 30 long, not protected, not a bare contraction. */
function markable(token: string): boolean {
  return /^[a-z]{3,30}$/.test(token) && !PROTECTED.has(token) && !BARE_CONTRACTIONS.has(token) && !looksLikeContraction(token);
}

/** Edit distance (with adjacent swaps) that gives up as soon as it must exceed `limit`. Reuses its buffers. */
const R0 = new Int32Array(33);
const R1 = new Int32Array(33);
const R2 = new Int32Array(33);
export function boundedDistance(a: string, b: string, limit: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > limit) return limit + 1;
  if (m > 32 || n > 32) return limit + 1;
  let prev2 = R0;
  let prev = R1;
  let cur = R2;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

const memo = new Map<string, string | null>();
const MEMO_MAX = 5000;

/** The one fix for a token that is not a word, or null (a word, ambiguous, or nothing close). */
export function suggestionFor(token: string): string | null {
  const hit = memo.get(token);
  if (hit !== undefined) return hit;
  const out = computeSuggestion(token);
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(token, out);
  return out;
}

function computeSuggestion(token: string): string | null {
  load();
  if (!markable(token) || dict!.has(token)) return null;
  const known = COMMON_MISSPELLINGS[token];
  if (known && dict!.has(known) && !PROTECTED.has(known)) return known;
  // Three-letter tokens have too many near words to guess from; only the known list fixes them.
  if (token.length < 4) return null;
  // Shape rule: a token ending in "nt", or starting with "nev", only gets a fix
  // that keeps that shape (so "...nt" never loses its "not", "nev..." never becomes "near").
  const keepsShape = (w: string) => (!token.endsWith("nt") || w.endsWith("nt")) && (!token.startsWith("nev") || w.startsWith("nev"));
  const limit = token.length >= 7 ? 2 : 1;
  let best = Infinity;
  let found: string[] = [];
  const tb = new Int32Array(26);
  for (let i = 0; i < token.length; i++) tb[token.charCodeAt(i) - 97]++;
  for (let len = token.length - limit; len <= token.length + limit; len++) {
    for (const idx of byKey!.get(`${token[0]}${len}`) ?? []) {
      // Each edit changes the letter counts by at most 2, so a big difference cannot be close.
      let diff = 0;
      const o = idx * 26;
      for (let c = 0; c < 26; c++) diff += Math.abs(tb[c] - bags[o + c]);
      if (diff > 2 * limit) continue;
      const w = words[idx];
      if (PROTECTED.has(w) || !keepsShape(w)) continue;
      const d = boundedDistance(token, w, Math.min(limit, best));
      if (d > limit || d > best) continue;
      if (d < best) {
        best = d;
        found = [w];
      } else found.push(w);
    }
  }
  return found.length === 1 ? found[0] : null;
}

/** The sentence a token sits in, for showing the mark in context. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("\n", index - 1)) + 1;
  const ends = [".", "!", "?", "\n"].map((c) => text.indexOf(c, index)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).trim().slice(0, 240);
}

/**
 * Every mark for a text, first occurrence of each misspelled token, with its
 * sentence. Looks at no more than MAX_SPELLING_TOKENS distinct non-words;
 * `capped` says when the rest went unchecked (the screen says so).
 */
export function spellingCheck(text: string): { marks: SpellingMark[]; capped: boolean } {
  load();
  const out: SpellingMark[] = [];
  const looked = new Set<string>();
  let capped = false;
  const re = /[A-Za-z]+(?:['\u2019][A-Za-z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? ""))) {
    const token = m[0];
    if (looked.has(token) || dict!.has(token)) continue;
    if (looked.size >= MAX_SPELLING_TOKENS) {
      capped = true;
      break;
    }
    looked.add(token);
    const fix = suggestionFor(token);
    if (fix) out.push({ word: token, suggestion: fix, sentence: sentenceAround(text, m.index) });
    if (out.length >= 30) break;
  }
  return { marks: out, capped };
}

export function spellingMarksFor(text: string): SpellingMark[] {
  return spellingCheck(text).marks;
}

/** The server's check on an accepted mark: exactly the fix this module offers for that token. */
export function isValidSpellingMark(mark: { word?: unknown; suggestion?: unknown } | null | undefined): boolean {
  if (!mark || typeof mark.word !== "string" || typeof mark.suggestion !== "string") return false;
  return suggestionFor(mark.word) === mark.suggestion;
}
