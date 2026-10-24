/**
 * Is a flagged claim already in what the person gave? (fix lane check,
 * 2026-10-24, Valjean walk defect 6.) Pure.
 *
 * The second check is a model. On a real walk it flagged a confirmed Master
 * Draft detail word for word ("I handle hiring, training, and scheduling for
 * the production crew") and the dates of a job on the person's own finished
 * resume ("from June 2015 to March 2019"). A claim the person's own evidence
 * states is never "not in anything you told us", so this deterministic test
 * overrides the model for exactly two shapes, and nothing else:
 *
 *   1. The claim, word for word (case, punctuation and number words aside),
 *      is in the person's words, has at least four words that are not numbers,
 *      years or months, and is not
 *      only in ANOTHER job's block of their words (a duty never moves between
 *      jobs on this rule; text outside every job block, such as a Master Draft
 *      detail, may stand anywhere).
 *   2. The claim is a date range, one of the person's jobs carries exactly
 *      that start and end, and the sentence holding the claim names that
 *      job's employer.
 *
 * Titles, employers, numbers and short phrases stay with the model's reading.
 */

import { normalizeForMatch } from "./grounding-accounting";
import { jobBlockText, jobsIn, readJobHeader, resolvePageJob, sameDates, type JobFacts } from "@crucible/core/src/jobResolver";

const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from", "as", "i", "my", "our", "is", "was", "were", "am", "are", "be"]);
const MONTH = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|present|current|now|since|through|until)$/;
// Words that say what was done: never a number, a year or a month (dates go through ownDates only).
const contentWords = (s: string) => normalizeForMatch(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/\d/.test(w) && !MONTH.test(w));
const has = (hay: string, needle: string) => {
  const n = normalizeForMatch(needle);
  return !!n && ` ${normalizeForMatch(hay)} `.includes(` ${n} `);
};

/** The person's words with every job block taken out (Master Draft details, the goal box, a summary). */
function outsideJobs(source: string, jobs: JobFacts[]): string {
  const inJobs = new Set(jobs.flatMap((j) => [...j.lines, ...j.body].map((l) => l.trim())));
  return source.split("\n").filter((l) => !inJobs.has(l.trim())).join("\n");
}

/** The output job a claim sits in, when it sits in exactly one. */
function outputJobOf(claim: string, output: string): JobFacts | null | undefined {
  const jobs = jobsIn(output);
  if (!jobs.length) return undefined;
  const lines = output.split("\n").filter((l) => has(l, claim));
  if (lines.length !== 1) return null;
  const owners = jobs.filter((j) => j.body.some((b) => b.trim() === lines[0].trim()) || j.lines.some((h) => h.trim() === lines[0].trim()));
  return owners.length === 1 ? owners[0] : null;
}

function wordForWord(claim: string, output: string, source: string): boolean {
  if (contentWords(claim).length < 4 || !has(source, claim)) return false;
  const own = jobsIn(source, { own: true });
  if (!own.length || has(outsideJobs(source, own), claim)) return true;
  const job = outputJobOf(claim, output);
  // In a letter or a summary (no job on the output), their own words anywhere stand.
  if (job === undefined) return true;
  if (!job) return false;
  const match = resolvePageJob(job.lines.join(" | "), source);
  return match.kind === "one" && has(jobBlockText(match.job), claim);
}

function sentenceOf(output: string, claim: string): string {
  const n = normalizeForMatch(claim);
  return output.split(/\n|(?<=[.!?])\s+/).find((s) => ` ${normalizeForMatch(s)} `.includes(` ${n} `)) ?? "";
}

function ownDates(claim: string, output: string, source: string): boolean {
  const c = claim.trim();
  // Only a date range and its joining words: "from June 2015 to March 2019", "2015 - 2019".
  if (/[a-z]{3,}/i.test(c.replace(/\b(?:from|to|through|until|since|present|current|now|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, ""))) return false;
  const claimed = readJobHeader(c);
  if (!claimed.start) return false;
  const sentence = sentenceOf(output, claim);
  if (!sentence) return false;
  return jobsIn(source, { own: true }).some((j) => sameDates(j, claimed) && !!j.employer.trim() && has(sentence, j.employer.split(/,/)[0]));
}

/** True when the person's own evidence (`source`) already states the flagged claim, as it sits in `output`. */
export function claimInEvidence(claim: string, output: string, source: string): boolean {
  if (!claim.trim() || !source.trim()) return false;
  return wordForWord(claim, output, source) || ownDates(claim, output, source);
}
