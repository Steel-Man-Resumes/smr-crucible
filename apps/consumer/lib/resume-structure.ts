import { isSectionHeader } from "@crucible/core/src/pageFitShared";
import { jobsIn } from "@crucible/core/src/jobResolver";

function hasContent(text: string, heading: RegExp): boolean {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => heading.test(line.trim()));
  if (index < 0) return false;
  for (const line of lines.slice(index + 1)) {
    if (!line.trim()) continue;
    if (isSectionHeader(line.trim())) return false;
    return true;
  }
  return false;
}

/** Cleanup must not obtain a green check by erasing the resume's structure. */
export function resumeStructureLoss(before: string, after: string): string[] {
  const lost: string[] = [];
  if (jobsIn(after).length < jobsIn(before).length) lost.push("a work-history heading");
  for (const [name, heading] of [
    ["the career summary", /^(?:CAREER |PROFESSIONAL )?(?:SUMMARY|PROFILE)$/im],
    ["the skills section", /^(?:CORE COMPETENCIES|(?:TECHNICAL |KEY |CORE )?SKILLS)$/im],
  ] as const) {
    if (heading.test(before) && (!heading.test(after) || (hasContent(before, heading) && !hasContent(after, heading)))) lost.push(name);
  }
  return lost;
}
