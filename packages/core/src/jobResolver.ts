/**
 * One job resolver (Phase 6 integration, review int-r1 M4/H4/M3). Every part of the product that asks
 * "what is a job header, what are its title, employer, place and dates, and which of the person's own jobs
 * is it" asks here: the renderer and page fit (through jobLineRoles), the finish page's job cards and
 * stricter-reading rule, and people scope (which job's words a claim is read against).
 *
 * - A job header is what jobLineRoles says it is, in a jobs section: a "|" line, or a header without pipes
 *   (dates on it or right under it), on one, two or three lines.
 * - Its facts: title (the first part), employer (the next part that is not a place or dates), place
 *   ("Libby, MT", "Libby MT"), and the dates as a start/end pair (month kept when written, "Present" open).
 * - Matching a page job to the person's own jobs: same title, an employer that is the same or contains the
 *   other (Inc, LLC and punctuation aside); when several of theirs match (a rehire), the same date pair
 *   decides. Anything else is "several" or "no_match", never a guess.
 *
 * Pure: no I/O.
 */

import { isContactLike, isDateText, isSectionHeader, jobLineRoles, splitTrailingYears, SECTION_JOBS_RE, US_STATE_CODES, US_STATE_NAMES_RE } from "./pageFitShared";

export interface JobDate {
  year: number;
  month?: number;
}

export interface JobFacts {
  title: string;
  employer: string;
  place: string;
  start?: JobDate;
  /** Undefined with `present` true for an open job. */
  end?: JobDate;
  present: boolean;
  /** The dates as written on the header ("8/2021 - Present"). */
  dates: string;
  /** The start and end as written ("8/2021", "Present"). */
  startText: string;
  endText: string;
  /** The header's lines, as written (one line, or two or three for a header without pipes). */
  lines: string[];
  /** The header as one line ("CNA | Valley Care Center, 2019 - 2021"). */
  header: string;
  /** The lines under the header, up to the next job or heading. */
  body: string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const ONE = String.raw`(?:(?:${MONTH}\s+)|(?:\d{1,2}\/(?:\d{1,2}\/)?))?(?:19|20)\d{2}`;
const RANGE_RE = new RegExp(String.raw`(${ONE})(?:\s*(?:[-\u2012-\u2015]|to|through|until)\s*(${ONE}|present|current|now))?`, "i");
const PLACE_RE = new RegExp(String.raw`^[A-Za-z .'-]+?,?\s+(?:(?:${US_STATE_CODES})\.?|${US_STATE_NAMES_RE})(?:\s+\d{5}(?:-\d{4})?)?$|^remote$`, "i");
const PLACE_CODE_CASE_RE = new RegExp(String.raw`\b(?:${US_STATE_CODES})\b`);

function datePoint(s: string): JobDate | undefined {
  const t = s.trim().toLowerCase();
  const y = t.match(/(?:19|20)\d{2}/);
  if (!y) return undefined;
  const num = t.match(/^(\d{1,2})\//);
  if (num) {
    const m = Number(num[1]);
    return { year: Number(y[0]), ...(m >= 1 && m <= 12 ? { month: m } : {}) };
  }
  const name = t.match(/^([a-z]{3})/);
  const i = name ? MONTHS.indexOf(name[1]) : -1;
  return { year: Number(y[0]), ...(i >= 0 ? { month: i + 1 } : {}) };
}

/** A place part: "Libby, MT", "Libby MT", "Spokane, Washington", "Remote" (a state code in capitals). */
export function isPlacePart(p: string): boolean {
  const t = p.trim();
  if (!PLACE_RE.test(t)) return false;
  if (/^remote$/i.test(t)) return true;
  // "Security Officer, PA" names a job: a code must be in capitals after a town name.
  return PLACE_CODE_CASE_RE.test(t) || new RegExp(String.raw`(?:${US_STATE_NAMES_RE})`, "i").test(t);
}

/** Places compared without punctuation, spacing or case ("Libby MT" is "Libby, MT"). */
export const placeKey = (p: string) => (p || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Employers compared without punctuation, case, "the" and company suffixes ("Acme Plant, Inc." is "acmeplant"). */
export const employerKey = (e: string) =>
  (e || "")
    .toLowerCase()
    .replace(/\b(?:inc|llc|co|corp|corporation|company|ltd|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
export const titleKey = (t: string) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The facts on one header (its lines joined with " | "). */
export function readJobHeader(header: string, lines: string[] = [header], body: string[] = []): JobFacts {
  let text = header.replace(/^\s*[-*\u2022]\s*/, "").trim();
  // Dates: the range at the end, wherever the separators are.
  let dates = "";
  let start: JobDate | undefined;
  let end: JobDate | undefined;
  let present = false;
  let startText = "";
  let endText = "";
  const all = Array.from(text.matchAll(new RegExp(RANGE_RE.source, "gi")));
  const last = all[all.length - 1];
  if (last) {
    dates = last[0].trim();
    startText = last[1].trim();
    endText = (last[2] ?? last[1]).trim();
    start = datePoint(last[1]);
    if (last[2]) {
      if (/^(?:present|current|now)$/i.test(last[2].trim())) present = true;
      else end = datePoint(last[2]);
    } else end = start;
    text = (text.slice(0, last.index) + text.slice((last.index ?? 0) + last[0].length)).replace(/\(\s*\)/g, " ");
  }
  // "Cashier at Quick Stop" -> title and employer.
  const pipeParts = text.split("|").map((part) => part.trim());
  const separateTitle = (lines.length > 1 ? splitTrailingYears(lines[0])?.title : undefined)
    ?? (pipeParts.length > 1 && pipeParts[1] && !isPlacePart(pipeParts[1]) ? pipeParts[0] : undefined);
  const parts = (separateTitle ? text.slice(text.indexOf("|") + 1) : text)
    .split(/\s*\|\s*|\s*,\s*|\s+[-\u2013\u2014]\s+|\t+/)
    .map((p) => p.trim())
    .filter((p) => /[A-Za-z]/.test(p));
  let title = separateTitle ?? parts[0] ?? "";
  let rest = separateTitle ? parts : parts.slice(1);
  const at = title.match(/^(.+?)\s+(?:at|@|for)\s+(.+)$/i);
  if (at) {
    title = at[1].trim();
    rest = [at[2].trim(), ...rest];
  }
  // Join "Libby" + "MT" split at the comma back into one place.
  const joined: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const next = rest[i + 1];
    if (next && /^(?:[A-Z]{2}\.?|[A-Za-z]+(?: [A-Za-z]+)?)$/.test(next) && isPlacePart(`${rest[i]}, ${next}`) && !isPlacePart(rest[i])) {
      joined.push(`${rest[i]}, ${next}`);
      i++;
    } else joined.push(rest[i]);
  }
  const place = joined.find((p) => isPlacePart(p)) ?? "";
  const employer = joined.find((p) => p !== place && !isDateText(p)) ?? "";
  return { title, employer, place, start, end, present, dates, startText, endText, lines, header: lines.join(" | "), body };
}

/**
 * The jobs in a text. `own` reads the person's own words: their whole text counts as a jobs section until
 * another heading (education, skills...) ends it, since an upload may have no "Experience" heading.
 */
export function jobsIn(text: string, opts: { own?: boolean } = {}): JobFacts[] {
  const raw = (text || "").split("\n").map((l) => l.trim());
  const lines = opts.own ? ["WORK EXPERIENCE", ...raw] : raw;
  const roles = jobLineRoles(lines);
  const out: JobFacts[] = [];
  let cur: { lines: string[]; body: string[] } | null = null;
  const flush = () => {
    if (cur) out.push(readJobHeader(cur.lines.join(" | "), cur.lines, cur.body));
    cur = null;
  };
  let section = "";
  lines.forEach((l, i) => {
    if (!l) return;
    if (isSectionHeader(l)) {
      flush();
      section = l.toUpperCase();
      return;
    }
    if (!SECTION_JOBS_RE.test(section)) return;
    const r = roles[i];
    if (r === "job") {
      flush();
      // A "|" line that is not a job shape (a pipe list) is not a job.
      // A contact line ("Libby, MT | (406) 555-0147") is never a job.
      if (l.includes("|") && (/@|https?:|www\.|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(l) || l.split("|").every((p) => isContactLike(p)))) return;
      if (l.includes("|") || splitTrailingYears(l) || roles.slice(i + 1).some((x) => x === "years" || x === "jobPart")) cur = { lines: [l], body: [] };
      return;
    }
    if (cur && (r === "jobPart" || r === "years") && cur.body.length === 0) {
      (cur as { lines: string[] }).lines.push(l);
      return;
    }
    if (cur) (cur as { body: string[] }).body.push(l);
  });
  flush();
  return out;
}

/** The person's job blocks keyed for scope: header and body joined. */
export function jobBlockText(j: JobFacts): string {
  return [...j.lines, ...j.body].join("\n");
}

const sameDate = (a?: JobDate, b?: JobDate) => (!a && !b) || (!!a && !!b && a.year === b.year && (a.month ?? 0) === (b.month ?? 0));
/** True when two jobs carry the same start/end pair, month for month. */
export function sameDates(a: JobFacts, b: JobFacts): boolean {
  return sameDate(a.start, b.start) && a.present === b.present && (a.present || sameDate(a.end, b.end));
}

export const employersMatch = (a: string, b: string) => {
  const x = employerKey(a);
  const y = employerKey(b);
  if (!x || !y) return !x && !y;
  return x === y || x.includes(y) || y.includes(x);
};

export type JobMatch =
  | { kind: "none" }
  | { kind: "one"; job: JobFacts }
  | { kind: "several"; jobs: JobFacts[] }
  | { kind: "no_match" };

/**
 * Which of the person's own jobs a page job is. "none": they have no job headers at all. "one": exactly one
 * of theirs has the same title and a matching employer (the same dates decide between several). "several":
 * more than one matches and the dates pick none or many (a merged rehire). "no_match": none matches.
 */
export function matchOwnJob(page: JobFacts, own: JobFacts[]): JobMatch {
  if (!own.length) return { kind: "none" };
  const t = titleKey(page.title);
  if (!t) return { kind: "no_match" };
  let hit = own.filter((j) => titleKey(j.title) === t && employersMatch(j.employer, page.employer));
  if (hit.length > 1) {
    const dated = hit.filter((j) => sameDates(j, page));
    if (dated.length === 1) return { kind: "one", job: dated[0] };
    return { kind: "several", jobs: hit };
  }
  return hit.length === 1 ? { kind: "one", job: hit[0] } : { kind: "no_match" };
}

/** A page job header line resolved against the person's own words. */
export function resolvePageJob(pageHeader: string, sourceText: string): JobMatch {
  return matchOwnJob(readJobHeader(pageHeader), jobsIn(sourceText, { own: true }));
}

/** The dates of a job as one short phrase ("2012 - 2014"). */
export function datesText(j: JobFacts): string {
  return j.dates || "no dates";
}
