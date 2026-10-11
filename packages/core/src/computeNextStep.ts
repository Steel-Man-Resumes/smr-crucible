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
import { TOUR_HREF, STAGE_WHY, whyForNextStep } from "./journeyStages";
import { getUserProfile, type UserProfile, type NextStepResult } from "./getUserProfile";

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour (plan Section 4)

/** How long "I don't need this now" keeps the disclosure step off the ladder. */
export const DISCLOSURE_NOT_NOW_DAYS = 30;

/** The person said "I don't need this now" to the disclosure step, recently enough. */
export function disclosureSnoozed(p: Pick<UserProfile, "disclosureNotNowAt">, now: number = Date.now()): boolean {
  const at = p.disclosureNotNowAt ? Date.parse(p.disclosureNotNowAt) : NaN;
  return Number.isFinite(at) && now - at < DISCLOSURE_NOT_NOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * DEADLINES COME BEFORE LESSONS (Codex review A6). A real interview or a
 * follow-up that has come due is time-bound; every rung of the ladder below
 * can wait a day. So these are checked first, ahead of the tour, the Forge,
 * tailoring and the disclosure step. Interview first: it is the bigger
 * moment. Returns null when nothing is due.
 *
 * "Interviewing" is the application status the person sets in the tracker;
 * there is no interview date column yet, so any application in that status
 * counts as an interview coming up.
 */
export function deadlineStep(p: UserProfile, now: number = Date.now()): NextStepResult | null {
  const interview = p.savedJobs.find((j) => j.status === "interviewing");
  if (interview) {
    const where = interview.company?.trim() || interview.jobTitle?.trim() || "your interview";
    const q = new URLSearchParams();
    if (interview.jobTitle?.trim()) q.set("role", interview.jobTitle.trim());
    if (interview.company?.trim()) q.set("company", interview.company.trim());
    const qs = q.toString();
    return {
      stage: 5,
      action: interview.company?.trim() ? `Get ready for your interview at ${where}` : "Get ready for your interview",
      href: `/dashboard/interview${qs ? `?${qs}` : ""}`,
      reason: "interview_upcoming",
    };
  }
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
  return null;
}

/**
 * Pure rules ladder. No I/O. Given a profile, return the one next action.
 * A deadline (deadlineStep) wins over every rung; it carries the ladder's own
 * stage as progressStage so the progress arc and the saved stage still show
 * how far the person has come.
 */
export function computeNextStep(p: UserProfile, now: number = Date.now()): NextStepResult {
  const deadline = deadlineStep(p, now);
  if (deadline) {
    const ladder = computeLadderStep(p, now);
    return { ...deadline, progressStage: ladder.stage, progressReason: ladder.reason };
  }
  return computeLadderStep(p, now);
}

/** The recommended order of lessons, with no deadline in play. */
export function computeLadderStep(p: UserProfile, now: number = Date.now()): NextStepResult {
  // Stage 0 -- orientation becomes mandatory after 2 deferrals
  if (!p.onboardingComplete && p.onboardingDeferrals >= 2) {
    return { stage: 0, action: "Take the tour and name your coach", href: TOUR_HREF, reason: "onboarding_required" };
  }

  // Stage 1 -- foundation must exist before anything else is useful
  if (!p.forgeComplete) {
    return { stage: 1, action: "Finish your resume in the Forge", href: "/intro", reason: "forge_incomplete" };
  }

  // Stage 0 (soft) -- foundation done but tour never taken: orient + name the coach
  if (!p.onboardingComplete) {
    return { stage: 0, action: "Take a quick tour and name your coach", href: TOUR_HREF, reason: "onboarding_pending" };
  }

  // Stage 2 -- find a first target
  if (p.savedJobs.length === 0) {
    return { stage: 2, action: "Pick a job to aim at", href: "/dashboard/jobs", reason: "no_saved_jobs" };
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

  // Stage 4 -- plan disclosure. Optional: "I don't need this now" takes it
  // off the ladder for DISCLOSURE_NOT_NOW_DAYS (the planner stays in the nav).
  if (!p.hasDisclosurePlan && !disclosureSnoozed(p, now)) {
    return { stage: 4, action: "Plan what to say about your background", href: "/dashboard/disclosure", reason: "no_disclosure_plan" };
  }

  // Stage 5 -- practice (target: at least 2 sessions)
  if (p.interviewSessionCount < 2) {
    return { stage: 5, action: "Practice your interview", href: "/dashboard/interview", reason: "needs_practice" };
  }

  // Stage 6 -- apply + track
  if (p.applicationCount === 0) {
    return { stage: 6, action: "Apply and track your application", href: "/dashboard/applications", reason: "no_application" };
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
export const NEXT_STEP_WHY: Record<number, string> = STAGE_WHY;

/**
 * Pure fallback WHY. No I/O, no AI. Returns the deterministic sentence for the
 * step's stage (defaulting to the "keep momentum" stage-2 line for any stage
 * outside the map), tagged so callers can show the source honestly.
 */
export function deterministicWhy(step: NextStepResult): {
  why: string;
  whySource: "deterministic";
} {
  return { why: whyForNextStep(step), whySource: "deterministic" };
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
  // current_stage is how far along the ladder the person is (staff tables and
  // reports read it), so a deadline step saves the ladder's stage, not its own.
  await query(
    `UPDATE users SET next_step_cache = $2, next_step_cached_at = now(), current_stage = $3 WHERE id = $1`,
    [userId, JSON.stringify(next), next.progressStage ?? next.stage]
  );
  return next;
}

/** Force a recompute on the next read (call from event handlers, plan Section 4). */
export async function invalidateNextStep(userId: string): Promise<void> {
  await query(`UPDATE users SET next_step_cached_at = NULL WHERE id = $1`, [userId]);
}
