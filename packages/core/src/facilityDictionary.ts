/**
 * Server only (it loads the bundled SCOWL word list through creativeSpelling).
 *
 * Combined review burden ruling: a single word a page shares with a place the
 * lane keeps off asks a one-tap question only when it is NOT a common English
 * word. "Folsom", "Quentin", "Attica" and "Rikers" still ask; "valley",
 * "view", "green" and "lake" never ask on their own. They still count inside
 * a held run and next to a facility or incarceration word.
 *
 * The matcher (creativeLaneShared) also runs in the browser, where the word
 * list is never shipped. So the server marks each facility-named entry it
 * hands out with the words of its names that ARE dictionary words
 * (details.commonWords). The screens and the server then judge alike. An
 * entry without the mark is judged as if none of its words were common: more
 * cards, never fewer holds.
 */

import type { PracticeEntry } from "./practiceRecordShared";
import { foldText } from "./creativeLaneShared";
import { isDictionaryWord } from "./creativeSpelling";

function wordList(text: string | null | undefined): string[] {
  if (!text) return [];
  return foldText(text).toLowerCase().replace(/['`‘’ʼ]/g, "").split(/[^a-z0-9]+/).filter((w) => /^[a-z]{3,}$/.test(w));
}

/** The entries, each facility-named one marked with the common words of its title, venue, earlier names and city. Never stored. */
export function withCommonWords(entries: PracticeEntry[]): PracticeEntry[] {
  return entries.map((e) => {
    if (!e.names_facility) return e;
    const all = [e.title, e.venue, e.city, ...(e.details.formerNames ?? [])].flatMap(wordList);
    const common = Array.from(new Set(all.filter((w) => isDictionaryWord(w)))).sort();
    return { ...e, details: { ...e.details, commonWords: common } };
  });
}
