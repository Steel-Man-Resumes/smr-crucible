/**
 * Resume text -> a small document model the layout reads.
 *
 * Input is the plain text the Forge already writes (same header and line
 * classification as pageFitShared). Output keeps every word in order. The only
 * text changes are layout, never wording:
 *  - "|" between parts of a job header, contact line, headline or skills list
 *    becomes a drawn separator (the parts stay in order);
 *  - the comma that joined "Employer, Dates" is layout (the dates move right);
 *  - a bullet marker ("- ") becomes a drawn square;
 *  - en and em dashes become a plain spaced hyphen (house rule for resumes).
 * Name and section headings are drawn in capitals.
 *
 * Phase 6 (Q4, a page a hiring manager knows at a glance): every known heading
 * spelling is a heading ("Work Experience" and "SKILLS" look the same), and in
 * an experience section every line under a job is drawn as a bullet. A date
 * line right under a job that has no dates of its own moves up beside the
 * title, where the dates sit on every other job. A lone line between the
 * contact line and the first heading (the writer puts its headline there,
 * after a blank line) is drawn as the headline under the name; a "Headline:"
 * label in front of it is layout, not wording, and is not drawn.
 */

import {
  isSectionHeader,
  isBulletLine,
  stripBulletMarker,
  isDateText,
  looksLikePlace,
  splitResumeHeader,
} from "@crucible/core/src/pageFitShared";
import { SECTION_SKILLS_RE } from "./style";

/** Sections whose entries are jobs: every line under a job there is a bullet. */
export const SECTION_JOBS_RE = /EXPERIENCE|WORK HISTORY|EMPLOYMENT|PROFESSIONAL HISTORY|CAREER HISTORY|PROFESSIONAL BACKGROUND|MILITARY|VOLUNTEER/;

export interface ModelHeader {
  name: string;
  headline: string;
  contact: string;
  notes: string;
  /** The order the lines came in, so the PDF reads in the person's order. */
  order?: Array<"name" | "headline" | "contact" | "notes">;
}

export type ModelBlock =
  | { kind: "section"; text: string }
  | { kind: "para"; text: string; role: "body" | "overview" }
  | { kind: "job"; title: string; rest: string[]; years: string }
  | { kind: "bullet"; text: string }
  | { kind: "skills"; label: string; items: string[]; sep: "pipe" | "comma" };

export interface ResumeModel {
  header: ModelHeader;
  blocks: ModelBlock[];
}

/** En and em dashes become a spaced plain hyphen; digits ranges keep the spaces. */
export function plainDashes(text: string): string {
  return text
    .replace(/\s*[–—]\s*/g, " - ")
    .replace(/\s{2,}/g, " ");
}

function clean(s: string): string {
  return plainDashes(s.trim());
}

/** Split a pipe-separated line into trimmed, non-empty parts. */
export function splitPipes(line: string): string[] {
  return line
    .split(/\s*[|•]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Split on commas that are not inside parentheses. */
export function splitCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** If `part` ends in ", <dates>" (or two spaces and dates), return the split. */
function splitTrailingDate(part: string): { head: string; years: string } | null {
  for (let i = 0; i < part.length; i++) {
    if (part[i] === ",") {
      const suffix = part.slice(i + 1).trim();
      if (suffix && isDateText(suffix)) return { head: part.slice(0, i).trim(), years: suffix };
    }
  }
  const m = part.match(/^(.*\S)\s{2,}(\S.*)$/);
  if (m && isDateText(m[2])) return { head: m[1].trim(), years: m[2].trim() };
  return null;
}

/**
 * Read "TITLE | Employer | Place | Years", "TITLE | Employer, Years",
 * "TITLE | Employer | Years" or "Institution, Place | Years".
 * Returns null when the line is not a job-style header.
 */
export function parseJobLine(line: string, strict: boolean): { title: string; rest: string[]; years: string } | null {
  if (!line.includes("|") || line.includes("@")) return null;
  const parts = splitPipes(line);
  if (parts.length < 2) return null;
  let years = "";
  for (let i = parts.length - 1; i >= 1; i--) {
    if (isDateText(parts[i])) {
      years = parts[i];
      parts.splice(i, 1);
      break;
    }
  }
  if (!years) {
    const last = parts.length - 1;
    const split = splitTrailingDate(parts[last]);
    if (split) {
      years = split.years;
      if (split.head) parts[last] = split.head;
      else parts.splice(last, 1);
    }
  }
  if (!years && strict) {
    // No date: a job header needs a place to be told apart from a skills list.
    const placeLike = parts.slice(1).some((p) => looksLikePlace(p));
    if (parts.length >= 3 && !placeLike) return null;
  }
  return { title: parts[0], rest: parts.slice(1), years };
}

/** "Label: a, b, c" or "Label: a | b | c" or a bare list. */
export function parseSkillsLine(line: string): { label: string; items: string[]; sep: "pipe" | "comma" } | null {
  let label = "";
  let rest = line;
  const m = line.match(/^([A-Z][^:|,]{0,40}):\s+(\S.*)$/);
  if (m) {
    label = m[1] + ":";
    rest = m[2];
  }
  if (/\s[|•]\s/.test(rest)) {
    const items = splitPipes(rest);
    if (items.length >= 2) return { label, items, sep: "pipe" };
  }
  const items = splitCommas(rest);
  if (items.length >= 2) return { label, items, sep: "comma" };
  return null;
}

export function parseResume(text: string): ResumeModel {
  const split = splitResumeHeader(text);
  const { headerLines } = split;
  const header = { ...split.header };
  let bodyLines = split.bodyLines;
  if (!header.headlineLine && header.nameLine) {
    // The headline after a blank line: one short plain line, then the first heading.
    const lines = bodyLines.map((l) => l.trim());
    const first = lines.findIndex((l) => l);
    const next = first >= 0 ? lines.findIndex((l, i) => i > first && l) : -1;
    const cand = first >= 0 ? lines[first] : "";
    if (
      cand &&
      next > first &&
      isSectionHeader(lines[next]) &&
      !isSectionHeader(cand) &&
      !isBulletLine(cand) &&
      !cand.includes("|") &&
      cand.length <= 120 &&
      !/[.!?]$/.test(cand)
    ) {
      header.headlineLine = cand.replace(/^headline:\s*/i, "");
      headerLines.push(header.headlineLine);
      bodyLines = bodyLines.slice(first + 1);
    }
  }
  const keyed: Array<["name" | "headline" | "contact" | "notes", string]> = [
    ["name", header.nameLine],
    ["headline", header.headlineLine],
    ["contact", header.contactLine],
    ["notes", header.publicNotesLine],
  ];
  const order = keyed
    .filter(([, v]) => v)
    .sort((a, b) => headerLines.indexOf(a[1]) - headerLines.indexOf(b[1]))
    .map(([k]) => k);
  const blocks: ModelBlock[] = [];
  let section = "";
  let prev: ModelBlock | null = null;
  // The job the lines that follow sit under, in a jobs section.
  let underJob: Extract<ModelBlock, { kind: "job" }> | null = null;
  const push = (b: ModelBlock) => {
    blocks.push(b);
    prev = b;
  };
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line) continue;
    if (isSectionHeader(line)) {
      section = line.toUpperCase();
      underJob = null;
      push({ kind: "section", text: clean(line).toUpperCase() });
      continue;
    }
    const inSkills = SECTION_SKILLS_RE.test(section);
    if (isBulletLine(line)) {
      push({ kind: "bullet", text: clean(stripBulletMarker(line)) });
      continue;
    }
    if (inSkills) {
      const sk = parseSkillsLine(line);
      if (sk) {
        push({ kind: "skills", label: clean(sk.label), items: sk.items.map(clean), sep: sk.sep });
        continue;
      }
      push({ kind: "para", text: clean(line), role: "body" });
      continue;
    }
    const job = parseJobLine(line, true);
    if (job) {
      const block: ModelBlock = { kind: "job", title: clean(job.title), rest: job.rest.map(clean), years: clean(job.years) };
      push(block);
      underJob = SECTION_JOBS_RE.test(section) ? block : null;
      continue;
    }
    if (underJob) {
      // A date line right under a job with no dates goes beside the title, like every other job.
      if (!underJob.years && (prev as ModelBlock | null) === underJob && isDateText(line)) {
        underJob.years = clean(line);
        continue;
      }
      // Every other line under a job is a bullet.
      push({ kind: "bullet", text: clean(line) });
      continue;
    }
    // A pipe list outside a skills section (four or more short parts) is a skills line.
    if (/\s\|\s/.test(line)) {
      const sk = parseSkillsLine(line);
      if (sk) {
        push({ kind: "skills", label: clean(sk.label), items: sk.items.map(clean), sep: sk.sep });
        continue;
      }
    }
    const p = prev as ModelBlock | null;
    const overview = p !== null && p.kind === "job";
    push({ kind: "para", text: clean(line), role: overview ? "overview" : "body" });
  }
  // Round 13 (SF-2): never print a heading with nothing under it (a cut can leave one).
  const kept = blocks.filter((b, i) => b.kind !== "section" || (i + 1 < blocks.length && blocks[i + 1].kind !== "section"));
  return {
    header: {
      name: clean(header.nameLine),
      headline: clean(header.headlineLine),
      contact: clean(header.contactLine),
      notes: clean(header.publicNotesLine),
      order,
    },
    blocks: kept,
  };
}

// ---------------------------------------------------------------------------
// Cover letters
// ---------------------------------------------------------------------------

export type LetterBlock =
  | { kind: "para"; lines: string[] } // one entry per drawn line group; joined for wrapping
  | { kind: "closing"; lines: string[] };

const CLOSING_RE = /^(sincerely|regards|best regards|respectfully|thank you|warm regards|best),?$/i;

export interface LetterModel {
  header: ModelHeader;
  blocks: LetterBlock[];
}

/** The letter carries the resume's name and contact line on top. */
export function parseLetter(text: string, headerFromResume?: string): LetterModel {
  const header = headerFromResume ? parseResume(headerFromResume).header : { name: "", headline: "", contact: "", notes: "" };
  const blocks: LetterBlock[] = [];
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const para of paras) {
    const lines = para.split("\n").map((l) => clean(l)).filter(Boolean);
    if (!lines.length) continue;
    if (CLOSING_RE.test(lines[0])) blocks.push({ kind: "closing", lines });
    else blocks.push({ kind: "para", lines: [lines.join(" ")] });
  }
  return { header: { ...header, headline: "", notes: "" }, blocks };
}
