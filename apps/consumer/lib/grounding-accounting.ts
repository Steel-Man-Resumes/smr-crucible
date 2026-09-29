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
 * So each flag is checked against the text before and after: it counts as
 * removed only if its phrase was in the original and is gone from what the
 * person receives. Anything still there, or that cannot be matched either way,
 * counts as something they should check.
 */

import type { GroundingFlag } from "./grounding-verify";

export type GroundedDoc = "resume" | "cover_letter";

export interface FlagOutcome {
  claim: string;
  doc: GroundedDoc;
  status: "removed" | "still_there";
}

/** Lowercase, letters digits and % only, single spaces: so a swapped dash,
 *  a curly quote or a line break never decides whether a phrase survived. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function contains(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  return n.length > 0 && ` ${normalizeForMatch(haystack)} `.includes(` ${n} `);
}

export function flagOutcome(flag: GroundingFlag, original: string, final: string): FlagOutcome["status"] {
  if (contains(original, flag.claim) && !contains(final, flag.claim)) return "removed";
  return "still_there";
}

export function accountFlags(
  checks: { doc: GroundedDoc; flags: GroundingFlag[]; original: string; final: string }[]
): { removed: number; residual: number; outcomes: FlagOutcome[] } {
  const outcomes: FlagOutcome[] = [];
  for (const c of checks) {
    for (const f of c.flags) {
      outcomes.push({ claim: f.claim, doc: c.doc, status: flagOutcome(f, c.original, c.final) });
    }
  }
  return {
    removed: outcomes.filter((o) => o.status === "removed").length,
    residual: outcomes.filter((o) => o.status === "still_there").length,
    outcomes,
  };
}
