/**
 * How many pages a document may run before it stays a draft (decisions D8 and
 * C1). Pure and client-safe: the finish page shows the card from it, and the
 * server (lib/revision-status.ts) holds the status with it.
 *
 *   ordinary resume      two pages when the true history fills them, never
 *                        more than two; one when the person chooses one (D8)
 *   international CV     follows the resume rule (C1)
 *   academic, clinical   as long as the true record, never filler: no limit (C1)
 *   artist resume        one to two pages; up to four when a call allows (C1)
 *   performer resume     always one page (C1)
 *
 * Nothing here ever cuts a line. Over the limit, the document stays a draft
 * and the person picks what comes off.
 */

import type { LengthChoice, RevisionDocKind } from "@crucible/core/src/artifactRevision";

export type { LengthChoice, RevisionDocKind };

export function isLengthChoice(v: unknown): v is LengthChoice {
  return v === "auto" || v === "one_page" || v === "two_pages";
}

/** The most pages this kind may run, or null for no limit. */
export function pageLimitFor(kind: RevisionDocKind, choice: LengthChoice = "auto", opts: { callAllowsFour?: boolean } = {}): number | null {
  switch (kind) {
    case "cv_academic":
    case "cv_clinical":
      return null;
    case "performer_resume":
      return 1;
    case "artist_resume":
      if (choice === "one_page") return 1;
      return opts.callAllowsFour ? 4 : 2;
    case "resume":
    case "cv_international":
    default:
      return choice === "one_page" ? 1 : 2;
  }
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

/** True when the page count is within the limit (and there is a page at all). */
export function lengthOk(pages: number, limit: number | null): boolean {
  return pages >= 1 && (limit === null || pages <= limit);
}

/**
 * The open item for a document over its limit, in plain words, or null when
 * it fits. It names the count and the limit and says the person decides.
 */
export function lengthOpenItem(pages: number, limit: number | null, choice: LengthChoice = "auto"): string | null {
  if (lengthOk(pages, limit) || limit === null) return null;
  const most = limit === 1 ? (choice === "one_page" ? "You chose one page" : "This kind is one page") : `${word(limit)[0].toUpperCase()}${word(limit).slice(1)} pages is the most`;
  return `Fix before you send: it runs ${word(pages)} pages. ${most}. Pick the lines to cut; nothing comes off by itself.`;
}
