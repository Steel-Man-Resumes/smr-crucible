/**
 * Offline measurement for the second check: plant one known flaw at a time
 * into a clean page, run a checker, and count catches, misses and false
 * alarms. Pure: the CLI in scripts/second-check-harness.ts does the file
 * reading and writing, and it writes aggregate numbers only (never page text).
 *
 * Planted flaws (each is one line changed on an otherwise clean page):
 * - invented_number:          a number in a bullet changed to one the person never gave,
 *                             or a count added to a bullet that had none.
 * - scope_inflation:          "helped with" / "assisted with" made "led", with any
 *                             "under the ..." / "with the ..." dropped; otherwise a
 *                             bullet rewritten as leading a team.
 * - credential_current:       a credential the person's words show as ended or not yet
 *                             finished, stated as current.
 * - invented_employer_detail: an employer described as something the person never said.
 */

import { getResumeStatus, type OpenItem } from "./resumeStatus";
import {
  credentialLinesOf,
  isDateLine,
  isEntryHeader,
  isSectionEnd,
  linesOf,
  numbersIn,
} from "./resumeMintCheckShared";
import { normalizeLine, type SecondCheckFinding } from "./secondCheckShared";

export type PlantedFlaw = "invented_number" | "scope_inflation" | "credential_current" | "invented_employer_detail";

export const PLANTED_FLAWS: readonly PlantedFlaw[] = [
  "invented_number",
  "scope_inflation",
  "credential_current",
  "invented_employer_detail",
];

export interface Planted {
  flaw: PlantedFlaw;
  /** The page with the one changed line. */
  page: string;
  /** The changed line as it now reads. */
  line: string;
  /** The line it replaced. */
  original: string;
}

/** Markdown page to plain page text: no bold or italic marks, no heading hashes, no rules. */
export function markdownToPlain(md: string): string {
  return (md || "")
    .split("\n")
    .filter((l) => !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l))
    .map((l) =>
      l
        .replace(/<!--.*?-->/g, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(^|[\s(|])\*(?!\s)(.+?)\*(?=$|[\s).,;:|])/g, "$1$2")
        .replace(/\s+$/, "")
    )
    .join("\n");
}

const isBulletLine = (l: string) => /^[-\u2022*]\s+/.test(l);
const YEARISH = /^(?:19|20)\d{2}$/;
const HAS_YEAR = /\b(?:19|20)\d{2}\b/;
const EXPERIENCE_RE = /^(?:(?:professional |work |relevant )?experience|employment(?: history)?|work history)$/i;

function replaceLine(page: string, original: string, next: string): string {
  const lines = page.split("\n");
  const i = lines.findIndex((l) => l.trim() === original);
  if (i < 0) return page;
  const indent = lines[i].match(/^\s*/)?.[0] ?? "";
  lines[i] = indent + next;
  return lines.join("\n");
}

function freshNumber(page: string, source: string): string {
  const used = new Set([...numbersIn(page), ...numbersIn(source)]);
  for (const n of ["37", "48", "64", "83", "112", "26", "57", "93"]) if (!used.has(n)) return n;
  return "419";
}

function plantNumber(page: string, source: string): Planted | null {
  const srcNums = numbersIn(source);
  const bullets = linesOf(page).filter(isBulletLine);
  const fresh = freshNumber(page, source);
  for (const b of bullets) {
    const m = Array.from(b.matchAll(/(?<![\w.,])\d+(?![\w.,]\d)/g)).find((x) => !YEARISH.test(x[0]) && srcNums.has(x[0]));
    if (!m || m.index === undefined) continue;
    const line = b.slice(0, m.index) + fresh + b.slice(m.index + m[0].length);
    return { flaw: "invented_number", page: replaceLine(page, b, line), line, original: b };
  }
  const plain = bullets.find((b) => numbersIn(b).size === 0);
  if (!plain) return null;
  const body = plain.replace(/[.;]\s*$/, "");
  const line = `${body}, ${fresh} a week.`;
  return { flaw: "invented_number", page: replaceLine(page, plain, line), line, original: plain };
}

const HELPED_RE = /\b(helped|assisted|assisting|helping)(\s+(?:out\s+)?(?:with|in|on))?\s+/i;
// A companion phrase after the helped verb: "under the operator", "with the nurse".
const COMPANION_RE = /\s+(?:under|with|alongside)\s+(?:the|a|an|his|her|their|my)\s+(?:[A-Za-z]+\s+)?(?:operator|nurse|lead|crew|team|supervisor|manager|foreman|mechanic|chef|cook|staff|others?)\b/i;

function plantScope(page: string): Planted | null {
  const bullets = linesOf(page).filter(isBulletLine);
  for (const b of bullets) {
    const m = b.match(HELPED_RE);
    if (!m || m.index === undefined) continue;
    const startOfBody = b.replace(/^[-\u2022*]\s+/, "").startsWith(m[0].trim().split(/\s+/)[0]);
    const verb = startOfBody ? "Led " : "led ";
    const rest = b.slice(m.index + m[0].length).replace(COMPANION_RE, "");
    const line = b.slice(0, m.index) + verb + rest;
    if (line === b) continue;
    return { flaw: "scope_inflation", page: replaceLine(page, b, line), line, original: b };
  }
  // No shared work on the page: make a plain duty read as leading a team.
  const first = bullets.find((b) => !/\b(?:led|lead|supervis\w*|manag\w*|train\w*)\b/i.test(b));
  if (!first) return null;
  const mark = first.match(/^[-\u2022*]\s+/)![0];
  const body = first.slice(mark.length);
  const line = `${mark}As the team lead, ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  return { flaw: "scope_inflation", page: replaceLine(page, first, line), line, original: first };
}

const ENDED_RE = /\b(?:expired|inactive|lapsed|not current|no longer (?:active|current|valid)|ran out|retest|in progress|enrolled|not yet)\b/i;
const CLOSED_RANGE_RE = /\b((?:19|20)\d{2})\s*(?:-|\u2013|to)\s*((?:19|20)\d{2})\b/;
const GENERIC = new Set(["certification", "certificate", "certified", "license", "licence", "licensed", "card", "training", "course", "issued", "state", "level"]);

function plantCredential(page: string, source: string): Planted | null {
  const units = source.split(/[\n.;]+/).map((u) => u.trim()).filter(Boolean);
  // Short credential lines (a credentials section) before long lines that mention one.
  const words = (l: string) => (l.match(/\S+/g) ?? []).length;
  const creds = credentialLinesOf(page).sort((a, b) => words(a) - words(b));
  for (const c of creds) {
    const key = (c.match(/[A-Za-z0-9]+/g) ?? []).find((w) => w.length >= 3 && !GENERIC.has(w.toLowerCase()));
    if (!key) continue;
    const said = units.filter((u) => u.toLowerCase().includes(key.toLowerCase()));
    const ended = said.some((u) => ENDED_RE.test(u)) || CLOSED_RANGE_RE.test(c);
    if (!ended || said.some((u) => /\b(?:active|current|valid)\b/i.test(u) && !ENDED_RE.test(u))) continue;
    let line: string;
    if (CLOSED_RANGE_RE.test(c)) line = c.replace(CLOSED_RANGE_RE, "$1 - Present, current");
    else if (ENDED_RE.test(c)) line = c.replace(ENDED_RE, "current");
    else line = `${c} | Current`;
    if (line === c) continue;
    return { flaw: "credential_current", page: replaceLine(page, c, line), line, original: c };
  }
  return null;
}

const EMPLOYER_DETAILS = ["a national chain", "a Fortune 500 supplier", "the regional headquarters", "a statewide contractor"];

function plantEmployer(page: string, source: string): Planted | null {
  const src = source.toLowerCase();
  const detail = EMPLOYER_DETAILS.find((d) => !src.includes(d.toLowerCase().replace(/^an? |^the /, ""))) ?? EMPLOYER_DETAILS[0];
  const ls = linesOf(page);
  const start = ls.findIndex((l) => EXPERIENCE_RE.test(l.replace(/:$/, "").trim()));
  if (start < 0) return null;
  for (let i = start + 1; i < ls.length; i++) {
    const h = ls[i];
    if (isSectionEnd(h)) break;
    // A job entry: a header with a year on it or on the line under it.
    if (!isEntryHeader(h) || !(HAS_YEAR.test(h) || isDateLine(ls[i + 1] ?? ""))) continue;
    const parts = h.split("|");
    // "Title, Employer, Place | dates" or "Title | Employer, Place | dates".
    const where = parts[0].includes(",") ? 0 : parts.length >= 3 ? 1 : -1;
    if (where < 0) continue;
    const segs = parts[where].split(",");
    const at = where === 0 ? 1 : 0;
    if (!segs[at] || !/^\s*[A-Z][A-Za-z]{2,}/.test(segs[at]) || /self[- ]?employ|independent|freelanc/i.test(segs[at])) continue;
    segs[at] = `${segs[at].replace(/\s+$/, "")} (${detail})${where === 1 && segs.length === 1 ? " " : ""}`;
    parts[where] = segs.join(",");
    const line = parts.join("|").replace(/\s+$/, "");
    return { flaw: "invented_employer_detail", page: replaceLine(page, h, line), line, original: h };
  }
  return null;
}

/** One planted flaw on an otherwise unchanged page, or null when the page has no place for it. */
export function plantFlaw(page: string, source: string, flaw: PlantedFlaw): Planted | null {
  switch (flaw) {
    case "invented_number":
      return plantNumber(page, source);
    case "scope_inflation":
      return plantScope(page);
    case "credential_current":
      return plantCredential(page, source);
    case "invented_employer_detail":
      return plantEmployer(page, source);
  }
}

// ---- scoring ---------------------------------------------------------------------

/** What a checker returns for one page: the open items the person would see. */
export type Checker = (page: string, source: string, ownResumeText?: string) => Promise<OpenItem[]>;

/** The mint check alone, as the status contract runs it (no defend step in the harness). */
export const mintChecker: Checker = async (page, source, ownResumeText) =>
  getResumeStatus({ resumeText: page, sourceText: source, requireDefend: false, ownResumeText }).openItems.filter((i) => i.line);

/** The mint check plus second-check findings from `second` (a provider run, or a stub in tests). */
export function withSecondCheck(second: (page: string, source: string) => Promise<SecondCheckFinding[]>): Checker {
  return async (page, source, ownResumeText) =>
    getResumeStatus({
      resumeText: page,
      sourceText: source,
      requireDefend: false,
      ownResumeText,
      secondCheckFindings: await second(page, source),
    }).openItems.filter((i) => i.line);
}

const onLine = (item: OpenItem, line: string) => {
  const a = normalizeLine(item.line);
  const b = normalizeLine(line);
  return !!a && (a === b || (a.length >= 4 && b.includes(a)));
};

export interface FlawTally {
  planted: number;
  caughtBlock: number;
  caughtFixOnly: number;
  missed: number;
  notApplicable: number;
}

/**
 * Items raised on clean pages (pages judged true). Only items on a line of
 * the page count as false alarms; items about the person's own words (a
 * number they gave that is not on the page) are counted apart, as offPage.
 */
export interface CleanTally {
  pages: number;
  /** Items on page lines: the false alarms a person would see. */
  items: number;
  block: number;
  fix: number;
  /** Page-line items per rule id. */
  byRule: Record<string, number>;
  /** Page-line items raised by the second check. */
  fromSecondCheck: number;
  /** Second-check items on clean pages by severity. */
  secondCheckBlock: number;
  secondCheckFix: number;
  /** Items about the person's words rather than a page line (not false alarms on the page). */
  offPage: number;
}

export interface CheckerScore {
  flaws: Record<PlantedFlaw, FlawTally>;
  clean: CleanTally;
}

export interface Pair {
  source: string;
  page: string;
  /** The person's own uploaded resume lines, when the pair has them (a whole line of theirs is not asked about). */
  ownResumeText?: string;
}

const emptyTally = (): FlawTally => ({ planted: 0, caughtBlock: 0, caughtFixOnly: 0, missed: 0, notApplicable: 0 });

/**
 * Score one checker over every pair. A planted flaw is caught when the
 * checker raises an item on the changed line that it did not already raise on
 * the original line of the clean page.
 */
export async function scoreChecker(pairs: Pair[], checker: Checker): Promise<CheckerScore> {
  const flaws = Object.fromEntries(PLANTED_FLAWS.map((f) => [f, emptyTally()])) as Record<PlantedFlaw, FlawTally>;
  const clean: CleanTally = {
    pages: 0, items: 0, block: 0, fix: 0, byRule: {}, fromSecondCheck: 0, secondCheckBlock: 0, secondCheckFix: 0, offPage: 0,
  };
  for (const { source, page, ownResumeText } of pairs) {
    const base = await checker(page, source, ownResumeText);
    const pageLines = linesOf(page);
    clean.pages++;
    for (const i of base) {
      if (!pageLines.some((l) => onLine(i, l))) { clean.offPage++; continue; }
      clean.items++;
      if (i.severity === "BLOCK") clean.block++;
      else clean.fix++;
      clean.byRule[i.rule] = (clean.byRule[i.rule] ?? 0) + 1;
      if (i.from === "second_check") {
        clean.fromSecondCheck++;
        if (i.severity === "BLOCK") clean.secondCheckBlock++;
        else clean.secondCheckFix++;
      }
    }
    for (const flaw of PLANTED_FLAWS) {
      const t = flaws[flaw];
      const p = plantFlaw(page, source, flaw);
      if (!p) { t.notApplicable++; continue; }
      t.planted++;
      const before = new Set(base.filter((i) => onLine(i, p.original)).map((i) => i.rule));
      const hits = (await checker(p.page, source, ownResumeText)).filter((i) => onLine(i, p.line) && !before.has(i.rule));
      if (hits.some((i) => i.severity === "BLOCK")) t.caughtBlock++;
      else if (hits.length) t.caughtFixOnly++;
      else t.missed++;
    }
  }
  return { flaws, clean };
}
