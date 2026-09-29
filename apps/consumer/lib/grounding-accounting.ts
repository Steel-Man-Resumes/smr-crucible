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
 *   also_in     found in the OTHER document (the check there missed it).
 * Only "removed" is reported as taken out. The rest ask the person to look.
 */

import type { GroundingFlag } from "./grounding-verify";
import { plainPunctuationText } from "./legal-sanitize";

export type GroundedDoc = "resume" | "cover_letter";
export type FlagStatus = "removed" | "changed" | "still_there" | "unmatched" | "also_in";

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
 *  so a swapped dash, a curly quote or "five" vs "5" never decides it.
 *  Bracketed template placeholders ("[Company Name]") are not content. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
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

/** How many times a normalized word or phrase appears in normalized text. */
function countOf(normText: string, phrase: string): number {
  if (!phrase) return 0;
  return ` ${normText} `.split(` ${phrase} `).length - 1;
}

function claimWords(claim: string): string[] {
  return normalizeForMatch(claim)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Pairs of claim words that sat side by side, looked for with stop words kept. */
function claimPairs(claim: string): string[] {
  const words = claimWords(claim);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) pairs.push(`${words[i]} ${words[i + 1]}`);
  return pairs;
}

/**
 * Is the claim still there in other words? Measured against a baseline: the
 * original with the flagged claim cut out. Words, pairs and numbers that were
 * already elsewhere in the document (a job year, "plant manager" in another
 * sentence) are in the baseline too, so they never make a removed claim look
 * reworded. Only what came back beyond the baseline counts.
 */
function survivesReworded(claim: string, finalText: string, baselineText: string): boolean {
  const fin = normalizeForMatch(finalText);
  const base = normalizeForMatch(baselineText);
  const grew = (phrase: string) => countOf(fin, phrase) > countOf(base, phrase);
  if (claimPairs(claim).some(grew)) return true;
  const words = claimWords(claim);
  const numbers = words.filter((w) => /\d/.test(w));
  const content = words.filter((w) => !/\d/.test(w));
  if (numbers.some(grew)) return true;
  const grown = content.filter(grew).length;
  if (content.length === 1) return grown === 1;
  return content.length >= 2 && grown >= Math.max(2, Math.ceil(content.length / 2));
}

export function flagOutcome(flag: GroundingFlag, original: string, final: string): FlagStatus {
  if (!contains(original, flag.claim)) return "unmatched";
  if (contains(final, flag.claim)) return "still_there";
  // The baseline: the original with the flagged claim cut out once.
  const normOrig = normalizeForMatch(original);
  const normClaim = normalizeForMatch(flag.claim);
  const at = ` ${normOrig} `.indexOf(` ${normClaim} `);
  const baseline = at < 0 ? normOrig : ` ${normOrig} `.slice(0, at) + " " + ` ${normOrig} `.slice(at + normClaim.length + 2);
  if (survivesReworded(flag.claim, final, baseline)) return "changed";
  return "removed";
}

/** A flag raised in one document, looked for in the other: the resume check may
 *  catch a claim the letter check missed. The exact phrase is "still there";
 *  two of its words side by side is "also in", a softer prompt to look. */
function inOtherDocument(flag: GroundingFlag, otherFinal: string): FlagStatus | null {
  if (contains(otherFinal, flag.claim)) return "still_there";
  const fin = normalizeForMatch(otherFinal);
  if (claimPairs(flag.claim).some((p) => countOf(fin, p) > 0)) return "also_in";
  return null;
}

export function accountFlags(
  checks: { doc: GroundedDoc; flags: GroundingFlag[]; original: string; final: string }[]
): { removed: number; changed: number; residual: number; unmatched: number; alsoIn: number; outcomes: FlagOutcome[] } {
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
    alsoIn: count("also_in"),
    outcomes,
  };
}
