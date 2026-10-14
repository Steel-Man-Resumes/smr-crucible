/**
 * Quiet, source-only repairs for a new Forge build. The writer's best wording
 * stays in place. Only a uniquely matched job's identity and skills the
 * person never supplied are changed here. Every change is returned for the
 * result page to show; uncertain facts remain questions in the finish gate.
 */
import { getResumeStatus } from "@crucible/core/src/resumeStatus";
import { jobsIn, matchOwnJob, readJobHeader } from "@crucible/core/src/jobResolver";
import { cutTerm, jobHeaderReview } from "./finish-gate";

export interface ForgeAutoRepair {
  kind: "job" | "skill";
  before: string;
  after: string;
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
  const status = getResumeStatus({ resumeText: text, sourceText: ownWords, requireDefend: false });
  const terms = [...new Set(status.openItems.filter((item) => item.kind === "grid_term" || item.kind === "grid_scope_term").map((item) => item.line))];
  for (const term of terms) {
    const next = cutTerm(text, term);
    if (next === text) continue;
    repairs.push({ kind: "skill", before: term, after: "" });
    text = next;
  }
  return { text, repairs };
}
