/**
 * computeNextStep -- the single most valuable action for a user right now.
 *
 * Master plan Section 4 (Intelligence Engine). Deterministic-first per the Codex
 * note: a clear rules ladder over the user's real profile. AI explanation can be
 * layered on later; the ladder must be understandable and correct first.
 *
 * IMPORTANT -- gate data sources (see getUserProfile for the gaps):
 *  - Stage 3 gate reads job_application.resume_artifact_id, which NOTHING sets yet.
 *  - Stage 5 gate reads server-side interview_prep artifacts, but interview
 *    practice is currently localStorage-only.
 * Those gates will only advance once the resume-builder and interview tools are
 * instrumented to persist completion server-side. The ladder is correct; the
 * instrumentation is a tracked backlog item.
 */

import { query } from "./db";
import { getUserProfile, type UserProfile, type NextStepResult } from "./getUserProfile";

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour (plan Section 4)

/** Pure rules ladder. No I/O. Given a profile, return the one next action. */
export function computeNextStep(p: UserProfile): NextStepResult {
  // Stage 0 -- orientation becomes mandatory after 2 deferrals
  if (!p.onboardingComplete && p.onboardingDeferrals >= 2) {
    return { stage: 0, action: "Complete your orientation", href: "/dashboard?tour=1", reason: "onboarding_required" };
  }

  // Stage 1 -- foundation must exist before anything else is useful
  if (!p.forgeComplete) {
    return { stage: 1, action: "Build your foundation", href: "/intro", reason: "forge_incomplete" };
  }

  // Stage 0 (soft) -- foundation done but tour never taken: orient + name the coach
  if (!p.onboardingComplete) {
    return { stage: 0, action: "Take a quick tour and name your coach", href: "/dashboard?tour=1", reason: "onboarding_pending" };
  }

  // Stage 2 -- find a first target
  if (p.savedJobs.length === 0) {
    return { stage: 2, action: "Find your first target job", href: "/dashboard/jobs", reason: "no_saved_jobs" };
  }

  // Stage 3 -- tailor a resume to a saved target
  if (!p.hasResumeTailoredToTarget) {
    const target = p.savedJobs.find((j) => !j.resumeTailored) ?? p.savedJobs[0];
    return {
      stage: 3,
      action: `Tailor your resume for ${target.jobTitle}`,
      // Live route is application-tailor (the resume-builder rename never
      // shipped); the old href 404ed from the next-step card.
      href: `/dashboard/application-tailor?job=${target.id}`,
      reason: "resume_not_tailored",
    };
  }

  // Stage 4 -- plan disclosure
  if (!p.hasDisclosurePlan) {
    return { stage: 4, action: "Plan how to talk about your background", href: "/dashboard/disclosure", reason: "no_disclosure_plan" };
  }

  // Stage 5 -- practice (target: at least 2 sessions)
  if (p.interviewSessionCount < 2) {
    return { stage: 5, action: "Practice your interview", href: "/dashboard/interview", reason: "needs_practice" };
  }

  // Stage 6 -- apply + track
  if (p.applicationCount === 0) {
    return { stage: 6, action: "Apply and track your application", href: "/dashboard/applications", reason: "no_application" };
  }

  // Stage 6 -- a follow-up has come due
  const now = Date.now();
  const due = p.savedJobs.find(
    (j) => j.followUpAt !== null && new Date(j.followUpAt).getTime() <= now
  );
  if (due) {
    return {
      stage: 6,
      action: `Time to follow up with ${due.company}`,
      href: "/dashboard/applications",
      reason: "follow_up_due",
    };
  }

  // Default -- keep momentum with fresh matches
  return { stage: 2, action: "Check your new matches today", href: "/dashboard/jobs", reason: "default_matches" };
}

/**
 * Deterministic WHY copy -- one plain sentence per computeNextStep stage (0-6).
 *
 * Phase 4.4: the AI phrases a warm WHY for the CURRENT step, but the AI never
 * decides WHAT the step is (computeNextStep owns that) and never gets to invent
 * facts. When the AI is unavailable, mocked, or errors, the route returns one of
 * these instead -- so the WHY line is always honest and always present. Every
 * stage the ladder can return MUST have an entry here (the adversarial suite
 * asserts full coverage). 6th-grade reading level; no em dashes; no emojis.
 */
export const NEXT_STEP_WHY: Record<number, string> = {
  0: "A quick tour shows you where everything lives, so the rest goes faster.",
  1: "Your foundation is the base every resume and plan is built on. It comes first.",
  2: "Picking a target job tells us what to aim your resume and practice at.",
  3: "A resume tailored to this job gets past filters and unlocks the rest of your tools.",
  4: "Planning how you talk about your record means you walk in ready, not caught off guard.",
  5: "A little practice makes the real interview feel familiar instead of scary.",
  6: "Applying and tracking keeps your search moving and reminds you when to follow up.",
};

/**
 * Pure fallback WHY. No I/O, no AI. Returns the deterministic sentence for the
 * step's stage (defaulting to the "keep momentum" stage-2 line for any stage
 * outside the map), tagged so callers can show the source honestly.
 */
export function deterministicWhy(step: NextStepResult): {
  why: string;
  whySource: "deterministic";
} {
  return { why: NEXT_STEP_WHY[step.stage] ?? NEXT_STEP_WHY[2], whySource: "deterministic" };
}

/**
 * Cache-aware next step. Reads users.next_step_cache; recomputes when missing or
 * older than 1 hour, then persists. Requires migration 016.
 */
export async function getNextStep(userId: string): Promise<NextStepResult | null> {
  const profile = await getUserProfile(userId);
  if (!profile) return null;

  const cachedAt = profile.nextStepCachedAt ? new Date(profile.nextStepCachedAt).getTime() : 0;
  const fresh = profile.nextStepCache && Date.now() - cachedAt < CACHE_MAX_AGE_MS;
  if (fresh) return profile.nextStepCache;

  const next = computeNextStep(profile);
  await query(
    `UPDATE users SET next_step_cache = $2, next_step_cached_at = now(), current_stage = $3 WHERE id = $1`,
    [userId, JSON.stringify(next), next.stage]
  );
  return next;
}

/** Force a recompute on the next read (call from event handlers, plan Section 4). */
export async function invalidateNextStep(userId: string): Promise<void> {
  await query(`UPDATE users SET next_step_cached_at = NULL WHERE id = $1`, [userId]);
}
