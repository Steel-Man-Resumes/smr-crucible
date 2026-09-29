/**
 * What the truth check actually did, counted from the text (2026-09-28).
 *
 * The page used to tell people "we removed N details" where N was the number of
 * flags the checker raised, and when nothing was left over it promised
 * "Your documents contain only what's true about you." Neither held: a flag is
 * a suspicion, not a removal, and a flagged phrase can survive the rewrite.
 * A persona run showed a letter still saying an expired certification was
 * "renewable" under that exact promise.
 *
 * Each flag is checked against the text before and after the check:
 *   removed     its phrase was in the original, and neither the phrase nor most
 *               of its words and numbers are left together on any line.
 *   changed     the exact phrase is gone, but most of its words or one of its
 *               numbers is still there on one line: it was reworded, not cut.
 *   still_there the exact phrase is still in the final text.
 *   unmatched   the phrase was never found in the original, so we cannot say
 *               what happened to it.
 * Only "removed" is reported as taken out. The rest ask the person to look.
 */

import type { GroundingFlag } from "./grounding-verify";
import { plainPunctuationText } from "./legal-sanitize";

export type GroundedDoc = "resume" | "cover_letter";
export type FlagStatus = "removed" | "changed" | "still_there" | "unmatched";

export interface FlagOutcome {
  claim: string;
  doc: GroundedDoc;
  status: FlagStatus;
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", fifty: "50", hundred: "100",
};

const STOP_WORDS = new Set(
  "a an the and or of to in on for with at by from as is are was were be been his her their your my i you we it this that over across every each per".split(" ")
);

/** Lowercase, letters digits and % only, number words as digits, single spaces:
 *  so a swapped dash, a curly quote or "five" vs "5" never decides it. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(" ")
    .trim();
}

function contains(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  return n.length > 0 && ` ${normalizeForMatch(haystack)} `.includes(` ${n} `);
}

function claimWords(claim: string): string[] {
  return normalizeForMatch(claim)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Two words of the claim that sat side by side still sit side by side on a
 *  line ("safety record", "consistent attendance", "forklift certification"). */
function keepsAPair(claim: string, text: string): boolean {
  const words = claimWords(claim);
  if (words.length < 2) return false;
  const lines = text.split(/\n+/).map((l) => ` ${normalizeForMatch(l)} `);
  for (let i = 0; i + 1 < words.length; i++) {
    const pair = ` ${words[i]} ${words[i + 1]} `;
    if (lines.some((l) => l.includes(pair))) return true;
  }
  return false;
}

/** Is the claim still there in other words? Errs toward "yes": the cost of a
 *  wrong "yes" is a glance, the cost of a wrong "taken out" is a claim sent. */
function survivesReworded(claim: string, text: string): boolean {
  const words = claimWords(claim);
  if (!words.length) return false;
  if (keepsAPair(claim, text)) return true;
  const numbers = words.filter((w) => /\d/.test(w));
  const content = words.filter((w) => !/\d/.test(w));
  return text.split(/\n+/).some((line) => {
    const have = new Set(normalizeForMatch(line).split(" "));
    const contentHits = content.filter((w) => have.has(w)).length;
    // A number of two or more digits (a year, 40, 12) is specific enough alone.
    if (numbers.some((n) => n.replace(/%/g, "").length >= 2 && have.has(n))) return true;
    if (numbers.some((n) => have.has(n)) && contentHits >= 1) return true;
    // A one-word claim still on the page is asked about, not called removed.
    if (content.length === 1 && numbers.length === 0) return contentHits === 1;
    return content.length >= 2 && contentHits >= Math.max(2, Math.ceil(content.length / 2));
  });
}

export function flagOutcome(flag: GroundingFlag, original: string, final: string): FlagStatus {
  if (!contains(original, flag.claim)) return "unmatched";
  if (contains(final, flag.claim)) return "still_there";
  if (survivesReworded(flag.claim, final)) return "changed";
  return "removed";
}

/** A flag raised in one document, looked for in the other: the resume check may
 *  catch a claim the letter check missed. Strict, so shared everyday words
 *  do not count: the exact phrase, or two of its words still side by side. */
function inOtherDocument(flag: GroundingFlag, otherFinal: string): FlagStatus | null {
  if (contains(otherFinal, flag.claim)) return "still_there";
  if (keepsAPair(flag.claim, otherFinal)) return "changed";
  return null;
}

export function accountFlags(
  checks: { doc: GroundedDoc; flags: GroundingFlag[]; original: string; final: string }[]
): { removed: number; changed: number; residual: number; unmatched: number; outcomes: FlagOutcome[] } {
  const outcomes: FlagOutcome[] = [];
  const seen = new Set<string>();
  const add = (claim: string, doc: GroundedDoc, status: FlagStatus) => {
    const key = `${doc}|${normalizeForMatch(claim)}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Shown on a job-seeker page, so it gets the same dash sweep as the documents.
    outcomes.push({ claim: plainPunctuationText(claim).text.slice(0, 200), doc, status });
  };
  for (const c of checks) {
    for (const f of c.flags) {
      if (!normalizeForMatch(f.claim)) continue;
      add(f.claim, c.doc, flagOutcome(f, c.original, c.final));
      for (const other of checks) {
        if (other.doc === c.doc) continue;
        const status = inOtherDocument(f, other.final);
        if (status) add(f.claim, other.doc, status);
      }
    }
  }
  const count = (s: FlagStatus) => outcomes.filter((o) => o.status === s).length;
  return {
    removed: count("removed"),
    changed: count("changed"),
    residual: count("still_there"),
    unmatched: count("unmatched"),
    outcomes,
  };
}
