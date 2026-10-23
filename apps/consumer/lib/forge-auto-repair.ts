/**
 * Quiet, source-only repairs for a new Forge build. The writer's best wording
 * stays in place. Only a uniquely matched job's identity and skills the
 * person never supplied are changed here. Every change is returned for the
 * result page to show; uncertain facts remain questions in the finish gate.
 */
import { resumeStructureLoss } from "./resume-structure";
import { getResumeStatus } from "@crucible/core/src/resumeStatus";
import { jobsIn, matchOwnJob, readJobHeader } from "@crucible/core/src/jobResolver";
import { numberTokens } from "@crucible/core/src/numberRead";
import { isSectionHeader } from "@crucible/core/src/pageFitShared";
import { cutTerm, jobHeaderReview, type GateItem } from "./finish-gate";

export interface ForgeAutoRepair {
  kind: "job" | "skill" | "claim" | "order" | "headline";
  before: string;
  after: string;
}

const jobRank = (job: ReturnType<typeof jobsIn>[number]): number =>
  job.present ? 999999 : (job.end?.year ?? 0) * 100 + (job.end?.month ?? 0);

/** A headline that calls someone a kind of worker must trace to a job they
 * actually listed. A target field alone does not turn into work history. */
function repairClaimedHeadline(text: string, ownJobs: ReturnType<typeof jobsIn>): { text: string; repair?: ForgeAutoRepair } {
  const lines = text.split("\n");
  const firstSection = lines.findIndex((line) => isSectionHeader(line.trim()));
  if (firstSection < 3 || !ownJobs.length) return { text };
  const at = lines.findLastIndex((line, index) => index < firstSection && !!line.trim());
  if (at < 2 || lines[at].includes("|") || !/\b(?:worker|specialist|manager|supervisor|operator|associate|technician|coordinator|professional)\b/i.test(lines[at])) return { text };
  if (ownJobs.some((job) => job.title && lines[at].toLowerCase().includes(job.title.toLowerCase()))) return { text };
  const actual = [...ownJobs].sort((a, b) => jobRank(b) - jobRank(a))[0]?.title;
  if (!actual || actual.toLowerCase() === lines[at].trim().toLowerCase()) return { text };
  const repair = { kind: "headline" as const, before: lines[at], after: actual };
  lines[at] = actual;
  return { text: lines.join("\n"), repair };
}

/** Reorder only a single uninterrupted group of uniquely source-matched,
 * fully dated one-line jobs. Ambiguous and split entries keep their order. */
function orderDatedJobs(text: string, ownJobs: ReturnType<typeof jobsIn>): { text: string; repair?: ForgeAutoRepair } {
  const lines = text.split("\n");
  const jobs = jobsIn(text);
  if (jobs.length < 2 || jobs.some((job) => job.lines.length !== 1 || !job.start || (!job.end && !job.present) || matchOwnJob(job, ownJobs).kind !== "one")) return { text };
  const starts = jobs.map((job) => lines.findIndex((line) => line.trim() === job.lines[0]));
  if (starts.some((at, index) => at < 0 || lines.filter((line) => line.trim() === jobs[index].lines[0]).length !== 1)) return { text };
  if (lines.slice(starts[0] + 1, starts[starts.length - 1]).some((line) => isSectionHeader(line.trim()))) return { text };
  const end = lines.findIndex((line, index) => index > starts[starts.length - 1] && isSectionHeader(line.trim()));
  const sectionEnd = end < 0 ? lines.length : end;
  const blocks = jobs.map((job, index) => ({ job, lines: lines.slice(starts[index], index + 1 < starts.length ? starts[index + 1] : sectionEnd) }));
  if (new Set(blocks.map(({ job }) => jobRank(job))).size !== blocks.length) return { text };
  const sorted = [...blocks].sort((a, b) => jobRank(b.job) - jobRank(a.job));
  if (sorted.every((block, index) => block === blocks[index])) return { text };
  const result = [...lines.slice(0, starts[0]), ...sorted.flatMap((block) => block.lines), ...lines.slice(sectionEnd)].join("\n");
  return { text: result, repair: { kind: "order", before: jobs[0].lines[0], after: sorted[0].job.lines[0] } };
}

/** Drop a surplus sentence only when the finish gate names its unsupported
 * number or unsettled credential and another substantive sentence remains.
 * A single-sentence line stays for the person to answer, not an empty page. */
export function cutUnsupportedExtraSentences(text: string, items: GateItem[], target: "resume" | "letter", source: string): { text: string; repairs: ForgeAutoRepair[] } {
  const lines = text.split("\n");
  const repairs: ForgeAutoRepair[] = [];
  const sourceNumbers = new Set(numberTokens(source).map((token) => token.value));
  const flagged = items.filter((item) => item.target === target && (item.kind === "credential_unsaid" || item.rule === "STD-T02"));
  for (const item of flagged) {
    const at = lines.findIndex((line) => line.trim() === item.line.trim());
    if (at < 0 || lines.filter((line) => line.trim() === item.line.trim()).length !== 1) continue;
    const sentences = lines[at].trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentences.length < 2) continue;
    const cut = sentences.findIndex((sentence) => item.kind === "credential_unsaid"
      ? !!item.subject && sentence.toLowerCase().includes(item.subject.toLowerCase())
      : numberTokens(sentence).some((token) => !sourceNumbers.has(token.value)));
    if (cut < 0) continue;
    const kept = sentences.filter((_, index) => index !== cut).join(" ");
    if ((kept.match(/[A-Za-z]+/g) ?? []).length < 5) continue;
    repairs.push({ kind: "claim", before: sentences[cut], after: "" });
    lines[at] = kept;
  }
  return { text: lines.join("\n"), repairs };
}

export function repairForgeResume(resume: string, ownResume: string, ownWords: string): { text: string; repairs: ForgeAutoRepair[] } {
  if (!resume.trim() || !ownWords.trim()) return { text: resume, repairs: [] };
  const repairs: ForgeAutoRepair[] = [];
  const ownJobs = jobsIn(ownResume, { own: true });
  const lines = resume.split("\n");
  const pageJobs = jobsIn(lines.slice(1).join("\n"));
  for (const page of pageJobs) {
    // Replacing one line of a split header would leave its old facts below.
    if (page.lines.length !== 1) continue;
    const match = matchOwnJob(page, ownJobs);
    if (match.kind !== "one") continue;
    const own = match.job;
    if (!own.title || !own.employer || !own.start || (!own.end && !own.present) || !own.dates) continue;
    if (jobHeaderReview(page.lines[0], ownResume, resume).changes.length === 0) continue;
    const fixed = [own.title, own.employer, own.place, own.dates.replace(/[\u2012-\u2015]/g, "-")].filter(Boolean).join(" | ");
    if (matchOwnJob(readJobHeader(fixed), ownJobs).kind !== "one") continue;
    const at = lines.findIndex((line) => line.trim() === page.lines[0]);
    if (at < 0 || lines.filter((line) => line.trim() === page.lines[0]).length !== 1) continue;
    repairs.push({ kind: "job", before: lines[at], after: fixed });
    lines[at] = fixed;
  }

  let text = lines.join("\n");
  const headline = repairClaimedHeadline(text, ownJobs);
  text = headline.text;
  if (headline.repair) repairs.push(headline.repair);
  const order = orderDatedJobs(text, ownJobs);
  text = order.text;
  if (order.repair) repairs.push(order.repair);
  const status = getResumeStatus({ resumeText: text, sourceText: ownWords, requireDefend: false });
  const terms = [...new Set(status.openItems.filter((item) => item.kind === "grid_term" || item.kind === "grid_scope_term").map((item) => item.line))];
  for (const term of terms) {
    const next = cutTerm(text, term);
    if (next === text || resumeStructureLoss(text, next).length) continue;
    repairs.push({ kind: "skill", before: term, after: "" });
    text = next;
  }
  return { text, repairs };
}
