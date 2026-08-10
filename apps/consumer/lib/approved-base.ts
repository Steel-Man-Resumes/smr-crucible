/**
 * Server-resolved approved-base contract (Phase 1A, 2026-08-10).
 *
 * The tailoring route accepts an `approvedArtifactId` ONLY. The server loads
 * the artifact itself and this pure predicate decides whether it may serve as
 * the trusted APPROVED BASE RESUME: the caller must own it, it must be a
 * resume, and it must carry a real approval mark (a locked lane baseline or
 * the pinned current resume). Client-supplied resume text can never reach the
 * trusted-grounding path again.
 *
 * Pure and side-effect free so the adversarial suite locks the boundary.
 */

export interface ApprovedBaseCandidate {
  user_id: string;
  artifact_type: string;
  is_locked: boolean;
  is_current: boolean;
  content: Record<string, unknown>;
}

export type ApprovedBaseDecision =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: "not_found" | "not_owner" | "not_resume" | "not_approved" };

export function resolveApprovedBase(
  artifact: ApprovedBaseCandidate | null,
  requestUserId: string | null | undefined
): ApprovedBaseDecision {
  if (!artifact) return { ok: false, reason: "not_found" };
  if (!requestUserId || artifact.user_id !== requestUserId) {
    return { ok: false, reason: "not_owner" };
  }
  if (artifact.artifact_type !== "resume") return { ok: false, reason: "not_resume" };
  if (!artifact.is_locked && !artifact.is_current) {
    return { ok: false, reason: "not_approved" };
  }
  return { ok: true, content: artifact.content };
}
