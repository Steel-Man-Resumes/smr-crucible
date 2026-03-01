/**
 * Forge Session Persistence
 *
 * Saves/loads Forge flow data to PostgreSQL.
 * Pre-auth: data lives in localStorage only.
 * Post-auth: data synced to consumer_profile + forge_session tables.
 */

import { query, getOne } from "./db";

export interface ForgeSessionSaveData {
  readinessStage?: string;
  resumeText?: string;
  resumeMethod?: string;
  goals?: string[];
  goalNarrative?: string;
  challenges?: string[];
  criminalRecord?: Record<string, unknown>;
  challengeNarratives?: Record<string, string>;
  preferences?: Record<string, string>;
  forgeOutput?: Record<string, unknown>;
  audience?: string;
  pagesVisited?: string[];
  startedAt?: string;
}

/**
 * Save Forge session data to DB for an authenticated user.
 * Upserts consumer_profile and forge_session records.
 */
export async function saveForgeSession(
  userId: string,
  sessionId: string,
  data: ForgeSessionSaveData
): Promise<void> {
  // Upsert consumer_profile
  await query(
    `INSERT INTO consumer_profile (user_id, readiness_stage, profile_data, narrative_data, preferences, skills, career_paths, forge_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       readiness_stage = COALESCE(EXCLUDED.readiness_stage, consumer_profile.readiness_stage),
       profile_data = EXCLUDED.profile_data,
       narrative_data = EXCLUDED.narrative_data,
       preferences = EXCLUDED.preferences,
       skills = EXCLUDED.skills,
       career_paths = EXCLUDED.career_paths,
       forge_output = COALESCE(EXCLUDED.forge_output, consumer_profile.forge_output),
       updated_at = now()`,
    [
      userId,
      data.readinessStage || null,
      JSON.stringify({
        resumeText: data.resumeText,
        resumeMethod: data.resumeMethod,
        challenges: data.challenges,
        criminalRecord: data.criminalRecord,
        challengeNarratives: data.challengeNarratives,
      }),
      JSON.stringify({
        goals: data.goals,
        goalNarrative: data.goalNarrative,
        narrative: data.forgeOutput?.narrative || null,
      }),
      JSON.stringify(data.preferences || {}),
      JSON.stringify(data.forgeOutput?.skills || []),
      JSON.stringify(data.forgeOutput?.career_paths || []),
      data.forgeOutput ? JSON.stringify(data.forgeOutput) : null,
    ]
  );

  // Upsert forge_session
  await query(
    `INSERT INTO forge_session (session_id, user_id, current_page, page_data, resume_text, forge_output, status, started_at, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, forge_session.user_id),
       current_page = EXCLUDED.current_page,
       page_data = EXCLUDED.page_data,
       resume_text = EXCLUDED.resume_text,
       forge_output = COALESCE(EXCLUDED.forge_output, forge_session.forge_output),
       status = EXCLUDED.status,
       completed_at = CASE WHEN EXCLUDED.forge_output IS NOT NULL THEN now() ELSE forge_session.completed_at END,
       last_activity_at = now()`,
    [
      sessionId,
      userId,
      data.pagesVisited?.[data.pagesVisited.length - 1] || "unknown",
      JSON.stringify({
        readiness: data.readinessStage,
        goals: data.goals,
        goalNarrative: data.goalNarrative,
        challenges: data.challenges,
        preferences: data.preferences,
        pagesVisited: data.pagesVisited,
      }),
      data.resumeText || null,
      data.forgeOutput ? JSON.stringify(data.forgeOutput) : null,
      data.forgeOutput ? "completed" : "in_progress",
      data.startedAt || new Date().toISOString(),
    ]
  );
}

/**
 * Load saved Forge data for an authenticated user.
 * Returns null if no profile exists.
 */
export async function loadForgeProfile(
  userId: string
): Promise<ForgeSessionSaveData | null> {
  const profile = await getOne<{
    readiness_stage: string | null;
    profile_data: Record<string, unknown>;
    narrative_data: Record<string, unknown>;
    preferences: Record<string, string>;
    skills: Array<{ name: string; category: string }>;
    career_paths: Array<Record<string, unknown>>;
    forge_output: Record<string, unknown> | null;
  }>(
    `SELECT readiness_stage, profile_data, narrative_data, preferences, skills, career_paths, forge_output
     FROM consumer_profile WHERE user_id = $1`,
    [userId]
  );

  if (!profile) return null;

  const profileData = profile.profile_data || {};

  return {
    readinessStage: profile.readiness_stage || undefined,
    resumeText: profileData.resumeText as string | undefined,
    resumeMethod: profileData.resumeMethod as string | undefined,
    goals: (profile.narrative_data?.goals as string[]) || undefined,
    goalNarrative: (profile.narrative_data?.goalNarrative as string) || undefined,
    challenges: (profileData.challenges as string[]) || undefined,
    criminalRecord: (profileData.criminalRecord as Record<string, unknown>) || undefined,
    challengeNarratives: (profileData.challengeNarratives as Record<string, string>) || undefined,
    preferences: profile.preferences || undefined,
    forgeOutput: profile.forge_output || undefined,
  };
}
