/**
 * Forge Session Persistence
 *
 * Saves/loads Forge flow data to PostgreSQL.
 * Pre-auth: data lives in localStorage only.
 * Post-auth: data synced to consumer_profile + forge_session tables.
 */

import { query, queryAsUser, getOneAsUser } from "./db";

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
 * Drop what carries no answer: undefined, null, blank strings, empty arrays and
 * empty objects. A sync only ever sends what the person actually gave, so an
 * empty value can never stand in for "erase what is already saved".
 */
export function dropEmpty<T extends Record<string, unknown>>(obj: T | undefined | null): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * The consumer_profile upsert.
 *
 * Rule for every column: an empty or missing incoming value never overwrites
 * what the account already holds, and a real new value does update it.
 *  - object columns (profile_data, narrative_data, preferences) are MERGED key
 *    by key. Incoming keys are already stripped of empties (dropEmpty), so a
 *    key not sent, or sent empty, keeps its saved value. Keys other writers
 *    own (contact from register / profile PATCH) are preserved too.
 *  - array columns (skills, career_paths) are replaced only when the incoming
 *    array is non-empty; an empty one is read as "nothing sent".
 *  - readiness_stage and forge_output already followed this rule.
 * Parameters stay parameters; the caller runs it through queryAsUser, so the
 * row-level-security role is unchanged.
 */
export const PROFILE_UPSERT_SQL = `INSERT INTO consumer_profile (user_id, readiness_stage, profile_data, narrative_data, preferences, skills, career_paths, forge_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       readiness_stage = COALESCE(EXCLUDED.readiness_stage, consumer_profile.readiness_stage),
       -- MERGE, never replace: profile_data also carries keys other writers own
       -- (contact from register/profile PATCH). A forge re-sync must update the
       -- forge fields it brings and PRESERVE everything else -- replacing the
       -- whole object silently wiped saved contact info (identity-desync bug,
       -- Fable analysis 2026-06-10). Same rule for the other object columns.
       profile_data = COALESCE(consumer_profile.profile_data, '{}'::jsonb) || EXCLUDED.profile_data,
       narrative_data = COALESCE(consumer_profile.narrative_data, '{}'::jsonb) || EXCLUDED.narrative_data,
       preferences = COALESCE(consumer_profile.preferences, '{}'::jsonb) || EXCLUDED.preferences,
       skills = COALESCE(NULLIF(EXCLUDED.skills, '[]'::jsonb), consumer_profile.skills),
       career_paths = COALESCE(NULLIF(EXCLUDED.career_paths, '[]'::jsonb), consumer_profile.career_paths),
       forge_output = COALESCE(EXCLUDED.forge_output, consumer_profile.forge_output),
       updated_at = now()`;

/** Parameters for PROFILE_UPSERT_SQL, in order. Pure, so it is unit tested. */
export function profileUpsertParams(userId: string, data: ForgeSessionSaveData): unknown[] {
  const forgeSkills = data.forgeOutput?.skills;
  const forgePaths = data.forgeOutput?.career_paths;
  return [
    userId,
    data.readinessStage || null,
    JSON.stringify(
      dropEmpty({
        resumeText: data.resumeText,
        resumeMethod: data.resumeMethod,
        challenges: data.challenges,
        criminalRecord: data.criminalRecord,
        challengeNarratives: data.challengeNarratives,
      })
    ),
    JSON.stringify(
      dropEmpty({
        goals: data.goals,
        goalNarrative: data.goalNarrative,
        narrative: data.forgeOutput?.narrative,
      })
    ),
    JSON.stringify(dropEmpty(data.preferences)),
    JSON.stringify(Array.isArray(forgeSkills) ? forgeSkills : []),
    JSON.stringify(Array.isArray(forgePaths) ? forgePaths : []),
    data.forgeOutput ? JSON.stringify(data.forgeOutput) : null,
  ];
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
  // Upsert consumer_profile (never lets an empty sync erase saved data)
  await queryAsUser(userId, PROFILE_UPSERT_SQL, profileUpsertParams(userId, data));

  // Upsert forge_session
  await query(
    `INSERT INTO forge_session (session_id, user_id, current_page, page_data, resume_text, forge_output, status, started_at, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (session_id) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, forge_session.user_id),
       current_page = EXCLUDED.current_page,
       page_data = EXCLUDED.page_data,
       resume_text = COALESCE(EXCLUDED.resume_text, forge_session.resume_text),
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
  const profile = await getOneAsUser<{
    readiness_stage: string | null;
    profile_data: Record<string, unknown>;
    narrative_data: Record<string, unknown>;
    preferences: Record<string, string>;
    skills: Array<{ name: string; category: string }>;
    career_paths: Array<Record<string, unknown>>;
    forge_output: Record<string, unknown> | null;
  }>(userId, 
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
