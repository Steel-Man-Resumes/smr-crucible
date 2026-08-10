/**
 * Journey Snapshot + Gate Decision (Phase 1D).
 *
 * Two problems this module fixes:
 *
 * 1. Activity truth was localStorage-only. "consumer_progress" (progress/page.tsx,
 *    interview/page.tsx, jobs/page.tsx, resources/page.tsx) is the only place
 *    resumes_built / job_searches / interviews_started / etc. lived -- it is
 *    per-browser, lost on a new device, and RefineryShell clears it on
 *    sign-out on purpose (shared-machine isolation). user_progress_event
 *    (migration 036) is the server ledger; recordProgressEvent() appends to
 *    it and buildJourneySnapshot() reads it back. The client keeps writing
 *    localStorage too for now (dual-write) -- it only retires in Phase 4.2.
 *
 * 2. Four gate implementations could disagree: OnboardingGate + useOnboarding
 *    (client-side fetch+filter), TierGate (tier rank only, a different axis),
 *    RefineryShell.isNavUnlocked (its own combination of tier + onboarding
 *    state), and computeCurrentBlock (server-side, via getUserProfile.
 *    hasResumeTailoredToTarget). computeGateDecision() below is the one place
 *    that turns a JourneySnapshot into a gate state, built on the SERVER
 *    definition of "resume tailored" (getUserProfile.hasResumeTailoredToTarget,
 *    which prefers the application_document provenance snapshot over the
 *    legacy resume_artifact_id link-existence guess). useOnboarding now reads
 *    this via GET /api/user/journey instead of deriving its own state.
 */

import { query, insert } from "./db";
import { getUserProfile } from "./getUserProfile";
import { countApplicationsSent } from "./applicationEvents";

/**
 * The full vocabulary of activity a client is allowed to log server-side.
 * Extend this list (not the migration) to add a new trackable action --
 * Phase 4.3 gamification reads the same table these write to.
 */
export const PROGRESS_EVENT_TYPES = [
  "session_start",
  "job_search",
  "resource_view",
  "resume_built",
  "bullet_written",
  "disclosure_plan_created",
  "interview_started",
  "interview_completed",
] as const;

export type ProgressEventType = (typeof PROGRESS_EVENT_TYPES)[number];

/** Pure validation helper -- kept separate from recordProgressEvent (DB I/O)
 *  so it is unit-testable without a database. */
export function isProgressEventType(value: unknown): value is ProgressEventType {
  return typeof value === "string" && (PROGRESS_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Append one activity event to the server ledger. Fire-and-forget from most
 * callers' point of view (the client helper apps/consumer/lib/track-progress.ts
 * ignores failures) -- this function itself throws on an unknown event type
 * so a typo at a call site fails loudly in dev/tests rather than silently
 * writing garbage.
 */
export async function recordProgressEvent(
  userId: string,
  eventType: ProgressEventType,
  context: Record<string, unknown> = {}
): Promise<void> {
  if (!isProgressEventType(eventType)) {
    throw new Error(`recordProgressEvent: unknown event type "${eventType}"`);
  }
  await insert("user_progress_event", {
    user_id: userId,
    event_type: eventType,
    context: JSON.stringify(context),
  });
}

export interface JourneySnapshot {
  version: 1;
  generatedAt: string;
  metrics: {
    /** count of "resume_built" rows in user_progress_event */
    resumesBuilt: number;
    /** count of "job_search" rows in user_progress_event */
    jobSearches: number;
    /** count of "resource_view" rows in user_progress_event */
    resourcesViewed: number;
    /** count of "session_start" rows in user_progress_event */
    totalSessions: number;
    /** count of "interview_started" rows in user_progress_event */
    interviewsStarted: number;
    /** count of "interview_completed" rows in user_progress_event */
    interviewsCompleted: number;
    /** count of "disclosure_plan_created" rows in user_progress_event */
    disclosurePlansCreated: number;
    /** countApplicationsSent(userId) -- the append-only application_status_event
     *  ledger (033), not user_progress_event: an application moved to
     *  'applied' is already tracked there and is the real source of truth. */
    applicationsSent: number;
    /** getUserProfile(userId).savedJobs.length */
    savedJobs: number;
    /** getUserProfile(userId).hasResumeTailoredToTarget -- the SERVER
     *  definition (application_document provenance, falling back to the
     *  legacy resume_artifact_id link). This is the field computeGateDecision
     *  gates "needs_resume" on. */
    resumeTailored: boolean;
    /** getUserProfile(userId).forgeComplete -- !!consumer_profile.forge_output */
    forgeComplete: boolean;
    /** getUserProfile(userId).profileComplete -- name + phone on file */
    profileComplete: boolean;
    /** getUserProfile(userId).hasDisclosurePlan -- additive beyond the Phase
     *  1D spec's metric list; kept alongside disclosurePlansCreated because
     *  RefineryShell's Interview Prep nav gate needs the real DB signal
     *  (artifact-count based), not the new event ledger, which has no
     *  history for plans created before this migration shipped. */
    hasDisclosurePlan: boolean;
  };
}

/**
 * Build a user's journey snapshot: one getUserProfile() call (identity, tier,
 * forge/resume/disclosure signals, saved jobs) plus one grouped COUNT query
 * over user_progress_event, plus countApplicationsSent (a third, cheap query
 * against the existing status-event ledger -- applicationsSent deliberately
 * does NOT come from user_progress_event, see the field comment above).
 */
export async function buildJourneySnapshot(userId: string): Promise<JourneySnapshot> {
  const [profile, eventCounts, applicationsSent, jobTargetedRows] = await Promise.all([
    getUserProfile(userId),
    query<{ event_type: string; count: string }>(
      `SELECT event_type, COUNT(*)::text AS count
       FROM user_progress_event
       WHERE user_id = $1
       GROUP BY event_type`,
      [userId]
    ),
    countApplicationsSent(userId),
    // Unlock-breadth parity with the retired useOnboarding client filter: a
    // job-targeted resume artifact unlocks even without a surviving saved-job
    // link (source === "job", or a targetJob on a non-forge artifact). Without
    // this OR, users who unlocked under the old client rule would relock.
    query<{ id: string }>(
      `SELECT id FROM refinery_artifact
       WHERE user_id = $1 AND artifact_type = 'resume'
         AND (
           target_context->>'source' = 'job'
           OR (COALESCE(target_context->>'targetJob', '') <> ''
               AND COALESCE(target_context->>'source', '') <> 'forge')
         )
       LIMIT 1`,
      [userId]
    ),
  ]);
  const hasJobTargetedResume = jobTargetedRows.length > 0;

  const counts: Partial<Record<ProgressEventType, number>> = {};
  for (const row of eventCounts) {
    if (isProgressEventType(row.event_type)) {
      counts[row.event_type] = parseInt(row.count, 10) || 0;
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    metrics: {
      resumesBuilt: counts.resume_built ?? 0,
      jobSearches: counts.job_search ?? 0,
      resourcesViewed: counts.resource_view ?? 0,
      totalSessions: counts.session_start ?? 0,
      interviewsStarted: counts.interview_started ?? 0,
      interviewsCompleted: counts.interview_completed ?? 0,
      disclosurePlansCreated: counts.disclosure_plan_created ?? 0,
      applicationsSent,
      savedJobs: profile?.savedJobs.length ?? 0,
      resumeTailored:
        (profile?.hasResumeTailoredToTarget ?? false) || hasJobTargetedResume,
      forgeComplete: profile?.forgeComplete ?? false,
      profileComplete: profile?.profileComplete ?? false,
      hasDisclosurePlan: profile?.hasDisclosurePlan ?? false,
    },
  };
}

export type GateState = "loading" | "needs_profile" | "needs_resume" | "full_access";

export interface GateDecision {
  state: GateState;
  reason: string;
  unlockAction: { label: string; href: string } | null;
  /** Phase 4.1 turns this on for a limited-tools trial lane; always false today. */
  trialMode: boolean;
}

/**
 * Pure. Same semantics OnboardingGate / useOnboarding enforce today:
 *   admin tier              -> full_access (god mode)
 *   !profileComplete        -> needs_profile (unlock: finish The Forge)
 *   !resumeTailored         -> needs_resume (unlock: tailor a resume)
 *   otherwise                -> full_access
 *
 * The hrefs match what OnboardingGate actually links today -- needs_profile
 * points at the external Forge app (https://forge.steelmanresumes.com), not
 * an in-app settings page; needs_resume points at /dashboard/application-tailor.
 */
export function computeGateDecision(snapshot: JourneySnapshot, tier: string | null): GateDecision {
  if (tier === "admin") {
    return {
      state: "full_access",
      reason: "Admin tier has full access to every tool.",
      unlockAction: null,
      trialMode: false,
    };
  }

  if (!snapshot.metrics.profileComplete) {
    return {
      state: "needs_profile",
      reason: "Profile is incomplete -- a name and phone number are required.",
      unlockAction: { label: "Finish in The Forge", href: "https://forge.steelmanresumes.com" },
      trialMode: false,
    };
  }

  if (!snapshot.metrics.resumeTailored) {
    return {
      state: "needs_resume",
      reason: "No resume has been tailored to a target job yet.",
      unlockAction: { label: "Tailor my resume", href: "/dashboard/application-tailor" },
      trialMode: false,
    };
  }

  return {
    state: "full_access",
    reason: "Profile is complete and a resume is tailored to a target job.",
    unlockAction: null,
    trialMode: false,
  };
}
