/** Grammatical changes only: never infer a duty from a title or a noun phrase. */
import { jobsIn } from "@crucible/core/src/jobResolver";

export type DutyTense = "present" | "past";
const VERBS: Record<string, [string, string]> = {
  managing: ["Manage", "Managed"], supervising: ["Supervise", "Supervised"],
  leading: ["Lead", "Led"], overseeing: ["Oversee", "Oversaw"],
  training: ["Train", "Trained"], coordinating: ["Coordinate", "Coordinated"],
  operating: ["Operate", "Operated"], loading: ["Load", "Loaded"],
  preparing: ["Prepare", "Prepared"], maintaining: ["Maintain", "Maintained"],
  handling: ["Handle", "Handled"], assisting: ["Assist", "Assisted"],
  supporting: ["Support", "Supported"], cleaning: ["Clean", "Cleaned"],
};

/** Unknown time, implicit action and coordinated verb phrases stay untouched. */
export function normalizeExplicitDutyLine(line: string, tense?: DutyTense): string {
  const match = line.match(/^(\s*(?:[-*\u2022]\s*)?)((?:(?:Was|Is)\s+)?Responsible for|Duties (?:included|include)|Responsibilities (?:included|include))\s+([A-Za-z]+)(\s+\S[^\r\n]*)$/i);
  if (!match) return line;
  const [, prefix, frame, gerund, object] = match;
  const verb = VERBS[gerund.toLowerCase()];
  // Do not leave "Manage operations and training staff" after removing the
  // governing frame, or rewrite a shared/qualified action into sole work.
  if (!verb || /\b(?:and|or)\s+(?:[a-z]+ly\s+)?[a-z]+ing\b/i.test(object)) return line;
  const explicit = /^(?:Was\b|.*\bincluded$)/i.test(frame) ? "past"
    : /^(?:Is\b|.*\binclude$)/i.test(frame) ? "present" : tense;
  if (!explicit) return line;
  return prefix + verb[explicit === "past" ? 1 : 0] + object;
}

/** Read time from the same current job, not the source's other employment. */
export function dutyTenseForLine(resume: string, line: string): DutyTense | undefined {
  const jobs = jobsIn(resume).filter((job) => job.body.some((body) => body.trim() === line.trim()));
  if (jobs.length !== 1) return undefined;
  return jobs[0].present ? "present" : jobs[0].end ? "past" : undefined;
}

/** Transform only existing, unique job-body lines. Never insert a missing job. */
export function normalizeResumeDutyWording(text: string): { text: string; repairs: Array<{ before: string; after: string }> } {
  const lines = text.split("\n");
  const repairs: Array<{ before: string; after: string }> = [];
  const bodies = new Set(jobsIn(text).flatMap((job) => job.body.map((line) => line.trim())));
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    if (!bodies.has(line.trim()) || lines.filter((candidate) => candidate.trim() === line.trim()).length !== 1) continue;
    const after = normalizeExplicitDutyLine(line, dutyTenseForLine(text, line));
    if (after === line) continue;
    repairs.push({ before: line, after });
    lines[at] = after;
  }
  return { text: lines.join("\n"), repairs };
}
