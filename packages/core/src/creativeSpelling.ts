/**
 * Spelling marks for the statement coach. Server only: it loads the bundled
 * word list (spellingWords.ts). Screens import nothing from here.
 *
 * Strict by design. A mark may:
 *   - replace ONLY a token that is not a dictionary word (so a real word,
 *     "not", "paint", "draw", is never touched);
 *   - replace it ONLY with a dictionary word within a small edit distance
 *     (1, or 2 for words of 7 letters or more), starting with the same letter;
 *   - be offered ONLY when one dictionary word is clearly closest: nearest by
 *     edit distance, then commonest by word-list level, then the kind of slip
 *     people make most (a doubled or dropped double letter, two letters
 *     swapped). Still tied: no mark at all.
 * Names, capitalised words, words with an apostrophe, numbers and very short
 * tokens are never marked. Negation and modal words are never produced.
 */

import { SPELLING_WORDS_BY_LEVEL } from "./spellingWords";
import { editDistance, type SpellingMark } from "./creativeStatement";

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
  paintting: "painting", sculpure: "sculpture", portrat: "portrait", inspriation: "inspiration",
};

let dict: Set<string> | null = null;
let level: Map<string, number> | null = null;
let byKey: Map<string, string[]> | null = null;

function load(): void {
  if (dict) return;
  dict = new Set();
  level = new Map();
  for (const [lv, words] of Object.entries(SPELLING_WORDS_BY_LEVEL)) {
    for (const w of words.split(" ")) {
      dict.add(w);
      level.set(w, Number(lv));
    }
  }
  for (const w of SUPPLEMENT) {
    dict.add(w);
    if (!level.has(w)) level.set(w, 55);
  }
  byKey = new Map();
  for (const w of dict) {
    const k = `${w[0]}${w.length}`;
    const list = byKey.get(k);
    if (list) list.push(w);
    else byKey.set(k, [w]);
  }
}

export function isDictionaryWord(word: string): boolean {
  load();
  return dict!.has(word.toLowerCase());
}

/** A token the coach is allowed to look at: lowercase letters only, 3 to 30 long, not protected. */
function markable(token: string): boolean {
  return /^[a-z]{3,30}$/.test(token) && !PROTECTED.has(token);
}

/** The one fix for a token that is not a word, or null (a word, ambiguous, or nothing close). */
export function suggestionFor(token: string): string | null {
  load();
  if (!markable(token) || dict!.has(token)) return null;
  const known = COMMON_MISSPELLINGS[token];
  if (known && dict!.has(known) && !PROTECTED.has(known)) return known;
  const limit = token.length >= 7 ? 2 : 1;
  let best = Infinity;
  let found: string[] = [];
  for (let len = token.length - limit; len <= token.length + limit; len++) {
    for (const w of byKey!.get(`${token[0]}${len}`) ?? []) {
      if (PROTECTED.has(w)) continue;
      const d = editDistance(token, w);
      if (d > limit || d > best) continue;
      if (d < best) {
        best = d;
        found = [w];
      } else found.push(w);
    }
  }
  if (found.length > 1) {
    const top = Math.min(...found.map((w) => level!.get(w) ?? 99));
    found = found.filter((w) => (level!.get(w) ?? 99) === top);
  }
  if (found.length > 1) {
    const slips = found.filter((w) => isCommonSlip(token, w));
    if (slips.length === 1) found = slips;
  }
  return found.length === 1 ? found[0] : null;
}

/** b is a with one letter doubled or one double undone, or two neighbours swapped. */
export function isCommonSlip(a: string, b: string): boolean {
  const doubled = (x: string, y: string) => {
    if (y.length !== x.length + 1) return false;
    for (let i = 0; i < y.length; i++) {
      if (y.slice(0, i) + y.slice(i + 1) === x && i > 0 && y[i] === y[i - 1]) return true;
    }
    return false;
  };
  if (doubled(a, b) || doubled(b, a)) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++) {
    if (a[i] !== b[i]) return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return false;
}

/** The sentence a token sits in, for showing the mark in context. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("\n", index - 1)) + 1;
  const ends = [".", "!", "?", "\n"].map((c) => text.indexOf(c, index)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).trim().slice(0, 240);
}

/** Every mark for a text, first occurrence of each misspelled token, with its sentence. */
export function spellingMarksFor(text: string): SpellingMark[] {
  const out: SpellingMark[] = [];
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? ""))) {
    const token = m[0];
    if (out.some((x) => x.word === token)) continue;
    const fix = suggestionFor(token);
    if (fix) out.push({ word: token, suggestion: fix, sentence: sentenceAround(text, m.index) });
    if (out.length >= 30) break;
  }
  return out;
}

/** The server's check on an accepted mark: exactly the fix this module offers for that token. */
export function isValidSpellingMark(mark: { word?: unknown; suggestion?: unknown } | null | undefined): boolean {
  if (!mark || typeof mark.word !== "string" || typeof mark.suggestion !== "string") return false;
  return suggestionFor(mark.word) === mark.suggestion;
}
