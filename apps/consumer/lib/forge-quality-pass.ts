/** A bounded second writing pass for a general Forge resume. */
import { credentialMentionsOf } from "@crucible/core/src/credentialMentions";
import { jobsIn } from "@crucible/core/src/jobResolver";
import { numberTokens } from "@crucible/core/src/numberRead";
import { CONTACT_LINE_RE, runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { runQualityCheck } from "@crucible/core/src/resumeQualityRules";
import { jobHeaderLines } from "./finish-gate";
import { isUsableResume } from "./writer-changes";

const REPAIRABLE = new Set(["objective", "summary", "generic_summary", "soft_skill_list", "duty_phrasing", "weak_bullet", "bullets", "heading"]);

export function forgeQualityIssueCount(text: string): number {
  return runQualityCheck(text).filter((finding) => REPAIRABLE.has(finding.rule)).length;
}

/** Bound model prompt size; use the full count for acceptance and reporting. */
export function forgeQualityIssues(text: string): Array<{ line: string; why: string }> {
  return runQualityCheck(text)
    .filter((finding) => REPAIRABLE.has(finding.rule))
    .slice(0, 6)
    .map(({ line, why }) => ({ line, why }));
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);
const numbers = (text: string) => numberTokens(text).map((token) => token.value).sort();
const credentials = (text: string) => credentialMentionsOf(text).map((mention) => mention.line.trim().toLowerCase()).sort();
const jobBodies = (text: string) => jobsIn(text).map((job) => job.body.filter((line) => /^\s*[-*\u2022]\s*\S/.test(line)).length);
const firstLine = (text: string) => text.split("\n").find((line) => line.trim())?.trim() ?? "";
const contactLines = (text: string) => text.split("\n").filter((line) => CONTACT_LINE_RE.test(line)).map((line) => line.trim());

/** The retry may improve wording only. The first checked page remains the fallback. */
export function acceptForgeQualityRevision(before: string, after: string, source: string): boolean {
  if (!isUsableResume(after) || forgeQualityIssueCount(after) >= forgeQualityIssueCount(before)) return false;
  if (firstLine(before) !== firstLine(after) || !same(contactLines(before), contactLines(after))) return false;
  if (!same(jobHeaderLines(before), jobHeaderLines(after))) return false;
  if (!same(numbers(before), numbers(after)) || !same(credentials(before), credentials(after))) return false;
  const originalBodies = jobBodies(before);
  const revisedBodies = jobBodies(after);
  if (!same(originalBodies.map(String), revisedBodies.map(String))) return false;
  return runMintCheck({ output: after, source, kind: "resume" }).blockCount <=
    runMintCheck({ output: before, source, kind: "resume" }).blockCount;
}
