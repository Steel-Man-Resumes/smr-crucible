/**
 * getUserProfile -- the single source of truth for a user's full state.
 *
 * Master plan Section 4 (Profile Accumulation). The AI coach and
 * computeNextStep() both consume this. Built deterministic-first: it reads only
 * tables that exist today (users + consumer_profile + job_application +
 * refinery_artifact). Calendar and SMS fields are present in the contract but
 * return safe defaults until their migrations land, so computeNextStep() can be
 * written against the full shape now without breaking.
 *
 * Canonical user table is "users" (plural, NextAuth) per 008_fix_consumer_fks.sql.
 * Requires migration 016 (coach + onboarding columns) to be applied.
 */

import { query, getOne } from "./db";
import type { UserTier } from "./userTier";

export interface NextStepResult {
  stage: number;
  action: string;
  href: string;
  reason?: string;
}

export interface SavedJobSummary {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  followUpAt: string | null;
  resumeTailored: boolean;
}

export interface UserProfile {
  // Identity
  id: string;
  name: string | null;
  email: string | null;
  tier: UserTier;

  // Forge output
  forgeComplete: boolean;
  readinessStage: string | null;
  topCareerPaths: string[];
  topSkills: string[];
  barriers: string[];

  // Journey + onboarding state
  currentStage: number;
  onboardingComplete: boolean;
  onboardingDeferrals: number;
  nextStepCache: NextStepResult | null;
  nextStepCachedAt: string | null;

  // Coach settings
  coachName: string;
  coachStyle: "supportive" | "balanced" | "direct";
  coachLength: "brief" | "full";
  coachFocus: "guide" | "answer";
  coachCreativity: number;

  // Job search
  savedJobs: SavedJobSummary[];
  applicationCount: number;
  hasResumeTailoredToTarget: boolean;

  // Disclosure
  hasDisclosurePlan: boolean;

  // Practice -- NOTE: interview practice is currently localStorage-only on the
  // client (consumer_progress key); it is NOT server-persisted yet. Until the
  // interview tool writes an 'interview_prep' artifact on session completion
  // (Stage 5 instrumentation), these counts read 0. The contract is ready; the
  // data source needs wiring.
  interviewSessionCount: number;
  practiceSessionsThisWeek: number;

  // Location
  city: string | null;
  state: string;

  // Calendar -- populated once the calendar_events migration lands
  upcomingEvents: unknown[];
  overdueEvents: unknown[];

  // SMS -- populated once the Twilio/SMS migration lands
  phone: string | null;
  smsConsent: boolean;
}

/** Pull a human label out of a career-path or skill element of unknown shape. */
function labelOf(el: unknown): string | null {
  if (typeof el === "string") return el;
  if (el && typeof el === "object") {
    const o = el as Record<string, unknown>;
    const v = o.title ?? o.name ?? o.label ?? o.path;
    if (typeof v === "string") return v;
  }
  return null;
}

/** "Milwaukee, WI" -> { city: "Milwaukee", state: "WI" }. Defaults state to WI. */
function parseLocation(loc: unknown): { city: string | null; state: string } {
  if (typeof loc !== "string" || !loc.trim()) return { city: null, state: "WI" };
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state: parts[1].slice(0, 2).toUpperCase() || "WI" };
  return { city: parts[0] || null, state: "WI" };
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  // 1. User row (coach + onboarding columns require migration 016)
  const user = await getOne<{
    id: string;
    name: string | null;
    email: string | null;
    tier: string | null;
    current_stage: number | null;
    onboarding_tour_complete: boolean | null;
    onboarding_tour_deferrals: number | null;
    next_step_cache: NextStepResult | null;
    next_step_cached_at: string | null;
    coach_name: string | null;
    coach_style: string | null;
    coach_length: string | null;
    coach_focus: string | null;
    coach_creativity: number | null;
  }>(
    `SELECT id, name, email, tier, current_stage,
            onboarding_tour_complete, onboarding_tour_deferrals,
            next_step_cache, next_step_cached_at,
            coach_name, coach_style, coach_length, coach_focus, coach_creativity
     FROM users WHERE id = $1`,
    [userId]
  );

  if (!user) return null;

  // 2. Consumer profile (Forge output)
  const profile = await getOne<{
    readiness_stage: string | null;
    profile_data: Record<string, unknown> | null;
    preferences: Record<string, unknown> | null;
    skills: unknown[] | null;
    career_paths: unknown[] | null;
    forge_output: Record<string, unknown> | null;
  }>(
    `SELECT readiness_stage, profile_data, preferences, skills, career_paths, forge_output
     FROM consumer_profile WHERE user_id = $1`,
    [userId]
  );

  const prefs = profile?.preferences ?? {};
  const { city, state } = parseLocation((prefs as Record<string, unknown>).location);

  const topCareerPaths = (profile?.career_paths ?? [])
    .map(labelOf)
    .filter((x): x is string => !!x)
    .slice(0, 3);
  const topSkills = (profile?.skills ?? [])
    .map(labelOf)
    .filter((x): x is string => !!x)
    .slice(0, 5);
  const barriers = Array.isArray((profile?.profile_data ?? {}).challenges)
    ? ((profile!.profile_data!.challenges as unknown[]).map(String))
    : [];

  // 3. Saved jobs + application count
  const jobs = await query<{
    id: string;
    job_title: string;
    company: string;
    status: string;
    follow_up_at: string | null;
    resume_artifact_id: string | null;
  }>(
    `SELECT id, job_title, company, status, follow_up_at, resume_artifact_id
     FROM job_application WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );

  const savedJobs: SavedJobSummary[] = jobs.map((j) => ({
    id: j.id,
    jobTitle: j.job_title,
    company: j.company,
    status: j.status,
    followUpAt: j.follow_up_at,
    resumeTailored: !!j.resume_artifact_id,
  }));

  // 4. Artifact-derived signals (disclosure plan present; interview practice count)
  const artifactStats = await getOne<{
    interview_total: string;
    interview_week: string;
    disclosure_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE artifact_type = 'interview_prep') AS interview_total,
       COUNT(*) FILTER (WHERE artifact_type = 'interview_prep'
                          AND created_at > now() - interval '7 days') AS interview_week,
       COUNT(*) FILTER (WHERE artifact_type = 'disclosure_plan') AS disclosure_count
     FROM refinery_artifact
     WHERE user_id = $1`,
    [userId]
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    tier: (user.tier as UserTier) || "client",

    forgeComplete: !!profile?.forge_output,
    readinessStage: profile?.readiness_stage ?? null,
    topCareerPaths,
    topSkills,
    barriers,

    currentStage: user.current_stage ?? 0,
    onboardingComplete: !!user.onboarding_tour_complete,
    onboardingDeferrals: user.onboarding_tour_deferrals ?? 0,
    nextStepCache: user.next_step_cache ?? null,
    nextStepCachedAt: user.next_step_cached_at ?? null,

    coachName: user.coach_name || "Guide",
    coachStyle: (user.coach_style as UserProfile["coachStyle"]) || "balanced",
    coachLength: (user.coach_length as UserProfile["coachLength"]) || "full",
    coachFocus: (user.coach_focus as UserProfile["coachFocus"]) || "guide",
    coachCreativity: user.coach_creativity ?? 50,

    savedJobs,
    applicationCount: jobs.filter((j) => j.status !== "saved").length,
    hasResumeTailoredToTarget: savedJobs.some((j) => j.resumeTailored),

    hasDisclosurePlan: Number(artifactStats?.disclosure_count ?? 0) > 0,

    interviewSessionCount: Number(artifactStats?.interview_total ?? 0),
    practiceSessionsThisWeek: Number(artifactStats?.interview_week ?? 0),

    city,
    state,

    // Extension points -- safe defaults until their migrations land
    upcomingEvents: [],
    overdueEvents: [],
    phone: null,
    smsConsent: false,
  };
}
