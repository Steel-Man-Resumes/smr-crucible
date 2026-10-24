/**
 * Is a flagged claim already in what the person gave? (fix lane check,
 * 2026-10-24, Valjean walk defect 6; tightened in fix round 1 after review.)
 * Pure.
 *
 * The second check is a model. On a real walk it flagged a confirmed Master
 * Draft detail word for word and the dates of one of the person's own jobs.
 * This deterministic test overrides the model only when ALL of these hold:
 *
 *   - Its kind allows it (review S3): never a number, a result, a title, an
 *     employer, a credential, a character or pronoun claim, or supervision.
 *   - The claim is the whole line or sentence it sits in (review S3): a
 *     supported fragment of an overstated line ("Led all hiring ... of 60
 *     across three plants") stays flagged.
 *   - Word for word (case, punctuation and number words aside), with at least
 *     four words that are not numbers, years or months, it is in the person's
 *     words AND attached to the same job (review B1):
 *       - inside one of their job blocks: the output line sits under that
 *         same job;
 *       - in a detail outside every job block (a Master Draft detail, a
 *         typed answer): under a job on the output only when the detail
 *         names that job's employer; in a letter or summary only when the
 *         sentence names no employer the detail does not name.
 *   - Or it is a date range equal to one of their jobs' start and end, in a
 *     sentence that names exactly one of their employers, that job's (review
 *     S4). A detail that states the dates with the employer counts the same.
 *
 * `source` is what may clear a claim: the person's own words and confirmed
 * details. A finished resume's lines are never in it (boss ruling, S1).
 */

import { normalizeForMatch } from "./grounding-accounting";
import { jobBlockText, jobsIn, readJobHeader, resolvePageJob, sameDates, type JobFacts } from "@crucible/core/src/jobResolver";

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "as", "i", "my", "our", "is", "was", "were", "am", "are", "be", "ve", "ive", "m", "s"]);
const MONTH = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|present|current|now|since|through|until)$/;
/** Words that say what was done: never a number, a year or a month (dates go through ownDates only). */
const contentWords = (s: string) => normalizeForMatch(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/\d/.test(w) && !MONTH.test(w));
const has = (hay: string, needle: string) => {
  const n = normalizeForMatch(needle);
  return !!n && ` ${normalizeForMatch(hay)} `.includes(` ${n} `);
};

/** Kinds the override may clear. Missing kind (an older stored check): treated as "other". */
const CLEARABLE_KINDS = new Set(["other", "wording", "skill", "tool", "scope", "date"]);

export interface EvidenceClaimOptions {
  /** The verifier's kind for the flag (review S3). */
  kind?: string;
  /** Employer names known from the person's pages (the resume being checked, their jobs), to read which employer a sentence names. */
  employers?: string[];
}

function sentenceOf(output: string, claim: string): string {
  const n = normalizeForMatch(claim);
  return output.split(/\n|(?<=[.!?])\s+/).find((s) => ` ${normalizeForMatch(s)} `.includes(` ${n} `)) ?? "";
}

/** The output line that holds the claim, when exactly one does. */
function lineOf(output: string, claim: string): string | null {
  const lines = output.split("\n").filter((l) => has(l, claim));
  return lines.length === 1 ? lines[0] : null;
}

/** Review S3: no content word of the line (or sentence) outside the claim. */
function coversWhole(claim: string, output: string): boolean {
  const own = new Set(contentWords(claim));
  const line = lineOf(output, claim);
  if (!line) return false;
  const body = line.replace(/^\s*[-•*]\s*/, "");
  const sentence = sentenceOf(body, claim) || body;
  return contentWords(sentence).every((w) => own.has(w));
}

const employerName = (e: string) => e.split(/,/)[0].trim();
function employersIn(text: string, known: string[]): string[] {
  return Array.from(new Set(known.map(employerName).filter((e) => e.length > 2 && has(text, e)).map((e) => normalizeForMatch(e))));
}

/** The person's words with every job block taken out (Master Draft details, typed answers, a summary). */
function outsideJobs(source: string, jobs: JobFacts[]): string[] {
  const inJobs = new Set(jobs.flatMap((j) => [...j.lines, ...j.body].map((l) => l.trim())));
  return source.split("\n").map((l) => l.trim()).filter((l) => l && !inJobs.has(l));
}

/** The output job a claim sits in: undefined when the output has no jobs, null when it is not exactly one. */
function outputJobOf(claim: string, output: string): JobFacts | null | undefined {
  const jobs = jobsIn(output);
  if (!jobs.length) return undefined;
  const line = lineOf(output, claim);
  if (!line) return null;
  const owners = jobs.filter((j) => j.body.some((b) => b.trim() === line.trim()) || j.lines.some((h) => h.trim() === line.trim()));
  return owners.length === 1 ? owners[0] : null;
}

function wordForWord(claim: string, output: string, source: string, known: string[]): boolean {
  if (contentWords(claim).length < 4 || !has(source, claim)) return false;
  const own = jobsIn(source, { own: true });
  const job = outputJobOf(claim, output);
  if (job === null) return false;
  // In one of their own job blocks: only under that same job.
  if (job) {
    const match = resolvePageJob(job.lines.join(" | "), source);
    if (match.kind === "one" && has(jobBlockText(match.job), claim)) return true;
  }
  // In a detail outside every job block (review B1).
  const details = outsideJobs(source, own).filter((d) => has(d, claim));
  if (!details.length) return false;
  if (job) {
    const employer = employerName(job.employer);
    return employer.length > 2 && details.some((d) => has(d, employer));
  }
  // A letter or a summary: the sentence names no employer the detail does not name.
  const named = employersIn(sentenceOf(output, claim), known);
  return details.some((d) => named.every((e) => has(d, e)));
}

function ownDates(claim: string, output: string, source: string, known: string[]): boolean {
  const c = claim.trim();
  // Only a date range and its joining words: "from June 2015 to March 2019", "2015 - 2019".
  if (contentWords(c).length) return false;
  const claimed = readJobHeader(c);
  if (!claimed.start) return false;
  const named = employersIn(sentenceOf(output, claim), known);
  // Review S4: exactly one of their employers in the sentence.
  if (named.length !== 1) return false;
  const [employer] = named;
  if (jobsIn(source, { own: true }).some((j) => sameDates(j, claimed) && normalizeForMatch(employerName(j.employer)) === employer)) return true;
  // A detail that states the same dates beside that employer.
  return outsideJobs(source, jobsIn(source, { own: true })).some((d) => {
    const dated = readJobHeader(d);
    return !!dated.start && sameDates(dated, claimed) && has(d, employer);
  });
}

/** True when the person's own evidence (`source`) already states the flagged claim, as it sits in `output`. */
export function claimInEvidence(claim: string, output: string, source: string, opts: EvidenceClaimOptions = {}): boolean {
  if (!claim.trim() || !source.trim()) return false;
  const kind = (opts.kind || "other").toLowerCase();
  if (!CLEARABLE_KINDS.has(kind)) return false;
  const known = [...(opts.employers ?? []), ...jobsIn(source, { own: true }).map((j) => j.employer), ...jobsIn(output).map((j) => j.employer)].filter(Boolean);
  if (kind === "date") return ownDates(claim, output, source, known);
  return (coversWhole(claim, output) && wordForWord(claim, output, source, known)) || ownDates(claim, output, source, known);
}
