/**
 * Metric emphasis -- decide which numbers in a resume bullet deserve bold.
 *
 * The point of bolding is to make ACHIEVEMENT land: "hauled 40 to 50 loads a
 * week", "22 cabins", "cut scrap 15%". The previous rule bolded every digit
 * run, which produced "MSHA Part **46**", "Flagger Certification (**2019**)"
 * and "Libby High School **2000**". Bolding a credential's part number or a
 * graduation year does not emphasize an accomplishment; it reads as a
 * rendering fault, which is worse than no bolding at all.
 *
 * So: bold quantities, skip identifiers. The two render paths (the React
 * preview in the app and the standalone print HTML) both call
 * `splitForMetricEmphasis` so they can never disagree about what is bold.
 */

/**
 * Words that turn a following number into an IDENTIFIER rather than a
 * quantity. "Part 46", "Class 8", "OSHA 10", "Title 29", "Level 2".
 */
const IDENTIFIER_LEAD =
  /(?:part|class|level|tier|type|grade|section|chapter|article|title|phase|stage|step|rev|revision|version|v|no|no\.|num|number|#|osha|msha|cfr|iso|ansi|aws|ul|nfpa|din|sae)$/i;

/** A standalone calendar year. Bolding "2019" emphasizes nothing. */
const YEAR = /^(?:19|20)\d{2}$/;

/**
 * Candidate numeric runs: percentages, currency, plain quantities, and
 * scaled figures (1.2M, 15K). Deliberately does NOT swallow a trailing
 * period, so a bullet-ending number keeps its sentence punctuation.
 */
const NUMERIC = /\$?\d[\d,]*(?:\.\d+)?(?:\s?[KMB]\b)?%?/g;

export interface MetricSegment {
  text: string;
  bold: boolean;
}

/**
 * Split `text` into alternating plain and emphasized segments.
 *
 * A numeric run is emphasized unless it is a calendar year, or the word
 * immediately before it marks it as an identifier.
 */
export function splitForMetricEmphasis(text: string): MetricSegment[] {
  const segments: MetricSegment[] = [];
  let cursor = 0;

  // Fresh regex per call: NUMERIC is /g, so a shared instance would carry
  // lastIndex between calls and skip matches in the next bullet.
  const scanner = new RegExp(NUMERIC.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    const value = match[0];
    const start = match.index;

    // The word immediately preceding this number, if any.
    const before = text.slice(cursor, start);
    const precedingWord = before.match(/([A-Za-z.#]+)[\s-]*$/)?.[1] ?? "";

    const isIdentifier = IDENTIFIER_LEAD.test(precedingWord);
    const isYear = YEAR.test(value.trim());

    if (before) segments.push({ text: before, bold: false });
    segments.push({ text: value, bold: !isIdentifier && !isYear });
    cursor = start + value.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), bold: false });
  }

  return segments.filter((s) => s.text !== "");
}

/**
 * Render a career path's salary range for display.
 *
 * The model frequently returns a range that already carries its own
 * parenthetical ("$45,000-$68,000/year (higher on prevailing-wage jobs)").
 * Wrapping that in another pair produced the nested "...peak season))" that
 * reads as a broken string. Wrap only when there is nothing to collide with.
 */
export function formatSalaryRange(range: string): string {
  const trimmed = range.trim();
  if (!trimmed) return "";
  return trimmed.includes("(") ? trimmed : `(${trimmed})`;
}
