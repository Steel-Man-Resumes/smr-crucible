/**
 * Quiet, source-only repairs for a new Forge build. The writer's best wording
 * stays in place. Only a uniquely matched job's identity and skills the
 * person never supplied are changed here. Every change is returned for the
 * result page to show; uncertain facts remain questions in the finish gate.
 */
import { getResumeStatus } from "@crucible/core/src/resumeStatus";
import { jobsIn, matchOwnJob, readJobHeader } from "@crucible/core/src/jobResolver";
import { numberTokens } from "@crucible/core/src/numberRead";
import { cutTerm, jobHeaderReview, type GateItem } from "./finish-gate";

export interface ForgeAutoRepair {
  kind: "job" | "skill" | "claim";
  before: string;
  after: string;
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
