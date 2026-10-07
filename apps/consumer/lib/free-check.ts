/**
 * The free checker (/check): a resume's basic checks, in plain verdicts, with
 * no sign-in, no AI call and nothing stored.
 *
 * Built only from checks that already exist and are tested:
 *  - the mint check's deterministic rules (runMintCheck), with the person's
 *    resume as both the page and the source, so only the rules about the page
 *    itself can fire (dates on the page, missing titles, placeholders, dashes,
 *    and the like);
 *  - dates and gaps (findDiscrepancies: open end dates, a gap of a year or more);
 *  - "can a machine read this": whether the file carried real text, whether
 *    the contact line is near the top, and whether the section names are ones
 *    a hiring system looks for.
 * Page fit is shown on the page by <PageFitLine> (the real layout, server side).
 *
 * No score, ever: a verdict per check, in words.
 *
 * Pure: safe in the browser and in unit tests.
 */

import { CONTACT_LINE_RE, runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { findDiscrepancies } from "./resume-discrepancies";

/** How the text arrived: from a file read as text, a file read as a picture, a file with no readable text, or pasted. */
export type CheckRead = "text" | "picture" | "none" | "pasted";

export type CheckVerdict = "good" | "fix" | "must-fix" | "note";

export interface CheckItem {
  verdict: CheckVerdict;
  /** One plain line. */
  title: string;
  /** Why, or what to do, in plain words. */
  detail?: string;
  /** The line of the resume it is about, quoted back. */
  line?: string;
}

export interface CheckSection {
  id: "machine" | "rules" | "dates";
  heading: string;
  items: CheckItem[];
}

export interface FreeCheckResult {
  sections: CheckSection[];
  mustFix: number;
  toFix: number;
}

/** Longest paste the checker takes (well above any resume). */
export const FREE_CHECK_MAX_CHARS = 50_000;

/** Section names a hiring system reads as the work history. */
const EXPERIENCE_HEADING_RE =
  /^(?:(?:professional |work |relevant )?experience|employment(?: history)?|work history|career history):?$/i;
const OTHER_HEADING_RE =
  /^(?:education(?: (?:and|&) training)?|training|skills|(?:core |key )?(?:skills|competencies)|certifications?(?: (?:and|&) licenses?)?|licenses?(?: (?:and|&) certifications?)?):?$/i;

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function machineSection(text: string, read: CheckRead): CheckSection {
  const items: CheckItem[] = [];
  if (read === "text") {
    items.push({
      verdict: "good",
      title: "A machine can read this file.",
      detail: "It has real text in it, not a picture of text.",
    });
  } else if (read === "picture") {
    items.push({
      verdict: "must-fix",
      title: "This file is a picture of text.",
      detail:
        "Many hiring systems can't read a scan or a photo. Save your resume as a PDF or Word file from the program you typed it in.",
    });
  } else if (read === "none") {
    items.push({
      verdict: "must-fix",
      title: "We couldn't read any text in this file.",
      detail: "If we can't read it, a hiring system probably can't either. Try the PDF or Word file you typed it in.",
    });
  } else {
    items.push({
      verdict: "note",
      title: "You pasted the text, so we didn't check the file.",
      detail: "Upload the file you send to employers to check that a machine can read it.",
    });
  }

  if (read === "none") return { id: "machine", heading: "Can a machine read it?", items };

  const lines = linesOf(text);
  const top = lines.slice(0, 8);
  if (top.some((l) => CONTACT_LINE_RE.test(l))) {
    items.push({ verdict: "good", title: "Your email or phone is near the top." });
  } else {
    items.push({
      verdict: "fix",
      title: "We couldn't find an email or phone near the top.",
      detail: "Put them right under your name, on one line, so a person and a machine both find them.",
    });
  }

  const headings = lines.filter((l) => l.length <= 40);
  if (headings.some((l) => EXPERIENCE_HEADING_RE.test(l))) {
    const named = headings.filter((l) => EXPERIENCE_HEADING_RE.test(l) || OTHER_HEADING_RE.test(l));
    items.push({
      verdict: "good",
      title: "Your section names are ones a hiring system looks for.",
      detail: `We found: ${Array.from(new Set(named.map((l) => l.replace(/:$/, "")))).join(", ")}.`,
    });
  } else {
    items.push({
      verdict: "fix",
      title: "We couldn't find a section called Experience or Work History.",
      detail: "Hiring systems look for plain section names. Put your jobs under one of those headings.",
    });
  }
  return { id: "machine", heading: "Can a machine read it?", items };
}

function rulesSection(text: string): CheckSection {
  const result = runMintCheck({ output: text, source: text, kind: "resume" });
  const items: CheckItem[] = result.findings.map((f) => ({
    verdict: f.severity === "BLOCK" ? "must-fix" : "fix",
    title: f.severity === "BLOCK" ? "Fix this before you send it." : "Worth fixing.",
    detail: f.why,
    line: f.line,
  }));
  if (items.length === 0) {
    items.push({ verdict: "good", title: "Nothing here breaks the basic rules we check." });
  }
  return { id: "rules", heading: "The basic rules", items };
}

function datesSection(text: string, now?: number): CheckSection {
  const found = findDiscrepancies(text, { now }).filter(
    (d) => d.kind === "open_end_date" || d.kind === "employment_gap"
  );
  const items: CheckItem[] = found.map((d) => ({
    verdict: "fix",
    title: d.label + ".",
    detail: d.question,
    line: d.evidence,
  }));
  if (items.length === 0) {
    items.push({
      verdict: "good",
      title: "Your dates read clearly.",
      detail: "No job without an end date, and no gap of a year or more between jobs.",
    });
  }
  return { id: "dates", heading: "Dates and gaps", items };
}

export function runFreeCheck(input: { text: string; read: CheckRead; now?: number }): FreeCheckResult {
  const text = (input.text || "").slice(0, FREE_CHECK_MAX_CHARS);
  const sections: CheckSection[] = [machineSection(text, input.read)];
  if (text.trim()) {
    sections.push(rulesSection(text), datesSection(text, input.now));
  }
  const all = sections.flatMap((s) => s.items);
  return {
    sections,
    mustFix: all.filter((i) => i.verdict === "must-fix").length,
    toFix: all.filter((i) => i.verdict === "fix").length,
  };
}

/** The one summary line. Counts of things to fix, never a score. */
export function freeCheckSummary(r: Pick<FreeCheckResult, "mustFix" | "toFix">): string {
  if (r.mustFix === 0 && r.toFix === 0) return "Nothing to fix in the checks we ran.";
  const parts: string[] = [];
  if (r.mustFix) parts.push(`${r.mustFix} to fix before you send it`);
  if (r.toFix) parts.push(`${r.toFix} worth fixing`);
  return parts.join(", ") + ".";
}

/** The call to action at the end of every result. */
export const FREE_CHECK_CTA = "Sign in free to fix these with t.ROY";
