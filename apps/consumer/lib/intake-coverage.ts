/**
 * Intake line-coverage measurement (Phase 2.2, 2026-08-10).
 *
 * Lossless intake needs a way to ANSWER "did any source line get silently
 * dropped?". computeLineCoverage takes the normalized source text and the parsed
 * ResumeDocument and reports what fraction of meaningful source lines are
 * accounted for somewhere in the doc -- a standard field, a typed content block,
 * or (once the tray is wired) a "Review these lines" custom block.
 *
 * This is a COVERAGE ESTIMATE, not a proof. It uses fuzzy token-overlap matching
 * (lowercase, punctuation-stripped, >=60% of a line's content words present in
 * some doc string) because exact-line matching is far too brittle -- the parser
 * reflows "Title | Company, 2019-2021" into separate fields, splits skills, etc.
 *
 * Pure. No network, no DB. This is the measurement the 2.2 acceptance corpus runs.
 */

import type { ResumeDocumentV3, ContentBlock } from "@/components/resume/resumeModel";

/** Coverage report for one source-text / doc pair. */
export interface LineCoverage {
  /** Meaningful source lines considered (empties, separators, headers excluded). */
  totalLines: number;
  /** How many of those lines matched something the doc actually contains. */
  coveredLines: number;
  /** Rounded percentage; 100 when there is nothing to lose (no meaningful lines). */
  coveragePct: number;
  /** The lines that matched nothing -- the candidate "unparsed" set. */
  unmatched: string[];
}

/** Content words in a string: lowercase alphanumeric tokens of length >= 2. */
function tokens(s: string): string[] {
  return (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (t) => t.length >= 2
  );
}

// Structural section headers are NOT content -- they carry no resume data, they
// only label the section below. A header line ("EXPERIENCE", "Skills:") should
// not count against coverage, so it is dropped from the meaningful-line set.
const SECTION_HEADER_WORDS = new Set([
  "additional",
  "skills",
  "summary",
  "experience",
  "education",
  "objective",
  "references",
  "reference",
  "certifications",
  "certification",
  "awards",
  "volunteer",
  "interests",
  "hobbies",
  "contact",
  "profile",
  "work history",
  "employment",
  "employment history",
  "professional experience",
  "professional summary",
  "work experience",
  "core competencies",
  "competencies",
  "activities",
  "projects",
  "publications",
  "leadership",
  "qualifications",
  "highlights",
]);

function isSectionHeaderLine(line: string): boolean {
  const norm = line.trim().toLowerCase().replace(/[:.]+$/, "").trim();
  return SECTION_HEADER_WORDS.has(norm);
}

/** All string values carried by one content block's items, plus its label. */
function blockStrings(block: ContentBlock): string[] {
  const out: string[] = [];
  if (block.kind === "custom") {
    out.push(block.label);
    for (const i of block.items) out.push(i.text);
    return out;
  }
  // Every other typed block: harvest all string-valued fields generically so new
  // typed blocks stay covered without touching this function.
  for (const item of block.items as Record<string, unknown>[]) {
    for (const v of Object.values(item)) {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") out.push(s);
    }
  }
  return out;
}

/**
 * Every string the doc actually contains, as both granular fields AND combined
 * per-entry strings. A source line often fuses several fields ("Jane Doe | 414
 * ... | Milwaukee, WI"), so a combined string is needed for the overlap match to
 * land; the granular strings catch reflowed content. Generous by design -- this
 * is a coverage estimate, and over-supplying doc strings only avoids false
 * "unmatched" reports.
 */
function collectDocStrings(doc: ResumeDocumentV3): string[] {
  const out: string[] = [];
  const c = doc.contact || ({} as ResumeDocumentV3["contact"]);
  out.push(c.name, c.phone, c.email, c.city, c.state);
  // Combined contact line (matches a fused header line).
  out.push([c.name, c.phone, c.email, c.city, c.state].filter(Boolean).join(" "));
  if (doc.summary) out.push(doc.summary);
  if (doc.headline) out.push(doc.headline);
  if (doc.publicNotes) out.push(doc.publicNotes);

  for (const e of doc.experience || []) {
    out.push(e.title, e.company, e.startDate, e.endDate);
    out.push(
      [e.title, e.company, e.startDate, e.endDate].filter(Boolean).join(" ")
    );
    for (const b of e.bullets || []) out.push(b);
  }
  for (const ed of doc.education || []) {
    out.push(ed.institution, ed.credential, ed.year);
    out.push([ed.credential, ed.institution, ed.year].filter(Boolean).join(" "));
  }
  // Skills each, plus one combined string (skills often arrive on one line).
  for (const s of doc.skills || []) out.push(s);
  out.push((doc.skills || []).join(" "));

  for (const block of doc.contentBlocks || []) out.push(...blockStrings(block));

  return out.filter((s) => typeof s === "string" && s.trim().length > 0);
}

/**
 * A line is COVERED if some single doc string shares >= 60% of the line's unique
 * content words. Max overlap across all doc strings wins -- one strong match is
 * enough (the line landed somewhere in the doc).
 */
function isCovered(lineTokens: string[], docTokenSets: Set<string>[]): boolean {
  const uniq = Array.from(new Set(lineTokens));
  if (uniq.length === 0) return true; // no content -> nothing to lose
  const THRESHOLD = 0.6;
  for (const d of docTokenSets) {
    let hit = 0;
    for (const t of uniq) if (d.has(t)) hit++;
    if (hit / uniq.length >= THRESHOLD) return true;
  }
  return false;
}

export function computeLineCoverage(
  sourceText: string,
  doc: ResumeDocumentV3
): LineCoverage {
  const docTokenSets = collectDocStrings(doc)
    .map((s) => new Set(tokens(s)))
    .filter((set) => set.size > 0);

  // Normalize source into meaningful lines: trim, drop empties, drop pure
  // punctuation/separator lines, drop structural section headers, drop lines
  // with no content words.
  const lines: string[] = [];
  for (const raw of String(sourceText || "").split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!/[a-z0-9]/i.test(trimmed)) continue; // separator / pure punctuation
    if (isSectionHeaderLine(trimmed)) continue;
    if (tokens(trimmed).length === 0) continue;
    lines.push(trimmed);
  }

  let covered = 0;
  const unmatched: string[] = [];
  for (const line of lines) {
    if (isCovered(tokens(line), docTokenSets)) covered++;
    else unmatched.push(line);
  }

  const totalLines = lines.length;
  const coveragePct =
    totalLines === 0 ? 100 : Math.round((covered / totalLines) * 100);
  return { totalLines, coveredLines: covered, coveragePct, unmatched };
}
