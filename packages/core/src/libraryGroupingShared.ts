/**
 * Phase 6.1 Library -- PURE resume-grouping resolver. No db/pg imports, so it is
 * safe in the client bundle (the Library page) and unit-testable without a DB.
 *
 * Within Resumes, the Library sub-groups into three buckets:
 *   - "masters"  : an approved, locked per-lane baseline (is_locked = true)
 *   - "company"  : a variant tailored to a specific company
 *                  (target_context.targetCompany is present), and not a master
 *   - "other"    : neither -- a base or untargeted resume
 *
 * The SAME predicate is mirrored in the SQL group filter (refineryArtifact
 * RESUME_GROUP_PREDICATES) so the server count and the client bucket agree.
 */

export type ResumeGroup = "masters" | "company" | "other";

export interface GroupableArtifact {
  artifact_type: string;
  is_locked?: boolean | null;
  target_context?: { targetCompany?: string | null } | null;
}

function hasTargetCompany(a: GroupableArtifact): boolean {
  const c = a.target_context?.targetCompany;
  return typeof c === "string" && c.trim().length > 0;
}

/** Which of the three resume buckets an artifact belongs to. Locked baselines
 *  win over company variants (a locked, company-tailored resume is still a
 *  master). Non-resumes return "other" (callers should not pass them). */
export function resolveResumeGroup(a: GroupableArtifact): ResumeGroup {
  if (a.is_locked) return "masters";
  if (hasTargetCompany(a)) return "company";
  return "other";
}

export const RESUME_GROUP_KEYS: ResumeGroup[] = ["masters", "company", "other"];

export function isResumeGroup(value: unknown): value is ResumeGroup {
  return value === "masters" || value === "company" || value === "other";
}

/** Count resumes into their three buckets (client-side convenience). */
export function countResumeGroups(
  resumes: GroupableArtifact[]
): Record<ResumeGroup, number> {
  const counts: Record<ResumeGroup, number> = { masters: 0, company: 0, other: 0 };
  for (const r of resumes) counts[resolveResumeGroup(r)]++;
  return counts;
}
