/**
 * Career lanes: the database half. Every statement runs AS the person
 * (queryAsUser), so the owner-only policies on career_lane and
 * lane_tool_intro (migration 073) decide what is visible; the WHERE user_id
 * clauses are a second, explicit layer, never the only one.
 *
 * The SQL lives in exported constants so the scratch-database test can run
 * the exact statements against the real schema.
 *
 * Lanes are archived, never hard deleted here. Only "delete my data" and
 * account deletion remove rows.
 */

import { queryAsUser, getOneAsUser } from "./db";
import {
  MAX_OPEN_LANES,
  MAX_TOTAL_LANES,
  laneNameFromTarget,
  cleanTargetRole,
  resolveLaneSettings,
  type CareerLane,
  type LaneSettingsInput,
  type LaneSettingsError,
  type LaneTool,
} from "./careerLaneShared";

export * from "./careerLaneShared";

const LANE_COLUMNS = `id, user_id, name, target_role, format, hybrid_uneven_history, hybrid_field_change,
  length_pref, created_at, updated_at, archived_at, is_first`;

export const LANE_LIST_SQL = `SELECT ${LANE_COLUMNS} FROM career_lane
  WHERE user_id = $1 AND ($2::boolean OR archived_at IS NULL)
  ORDER BY archived_at NULLS FIRST, created_at`;

export const LANE_GET_SQL = `SELECT ${LANE_COLUMNS} FROM career_lane WHERE id = $1 AND user_id = $2`;

export const LANE_OPEN_COUNT_SQL = `SELECT COUNT(*)::int AS n FROM career_lane WHERE user_id = $1 AND archived_at IS NULL`;

/** Open and total (archived included): the two caps a new lane must pass. */
export const LANE_COUNTS_SQL = `SELECT COUNT(*) FILTER (WHERE archived_at IS NULL)::int AS open, COUNT(*)::int AS total
  FROM career_lane WHERE user_id = $1`;

/**
 * The lane a screen opens in when the person has not picked one in this
 * browser: the open lane holding their newest resume (examples left out).
 * Null means main.
 */
export const LANE_OF_NEWEST_RESUME_SQL = `SELECT ra.lane_id FROM refinery_artifact ra
  JOIN career_lane l ON l.id = ra.lane_id AND l.user_id = ra.user_id AND l.archived_at IS NULL
  WHERE ra.user_id = $1 AND ra.artifact_type = 'resume' AND ra.is_demo = false
    AND ra.updated_at = (SELECT max(r2.updated_at) FROM refinery_artifact r2
                          WHERE r2.user_id = $1 AND r2.artifact_type = 'resume' AND r2.is_demo = false)
  LIMIT 1`;

export const LANE_INSERT_SQL = `INSERT INTO career_lane
  (user_id, name, target_role, format, hybrid_uneven_history, hybrid_field_change, length_pref)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING ${LANE_COLUMNS}`;

export const LANE_UPDATE_SQL = `UPDATE career_lane
  SET name = $3, target_role = $4, format = $5, hybrid_uneven_history = $6,
      hybrid_field_change = $7, length_pref = $8, updated_at = now()
  WHERE id = $1 AND user_id = $2
  RETURNING ${LANE_COLUMNS}`;

export const LANE_ARCHIVE_SQL = `UPDATE career_lane
  SET archived_at = CASE WHEN $3::boolean THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now()
  WHERE id = $1 AND user_id = $2
  RETURNING ${LANE_COLUMNS}`;

/**
 * The person's first lane, made from their Forge target, only when they have
 * never had a lane at all (open or archived). Two saves at once (two tabs,
 * even with different targets) cannot make two first lanes: the second finds
 * the first, or hits the one-first-lane unique index (is_first) and inserts
 * nothing.
 */
export const LANE_ENSURE_FIRST_SQL = `INSERT INTO career_lane (user_id, name, target_role, is_first)
  SELECT $1, $2, $3, true
  WHERE NOT EXISTS (SELECT 1 FROM career_lane WHERE user_id = $1)
  ON CONFLICT DO NOTHING
  RETURNING ${LANE_COLUMNS}`;

/**
 * Put one artifact in a lane ($3) or back in main ($3 NULL). The lane must be
 * this person's and open. The composite foreign key (lane_id, user_id) is the
 * hard guard; the EXISTS keeps an archived lane from gaining new work.
 */
export const ARTIFACT_SET_LANE_SQL = `UPDATE refinery_artifact SET lane_id = $3::uuid
  WHERE id = $1 AND user_id = $2
    AND ($3::uuid IS NULL OR EXISTS (
      SELECT 1 FROM career_lane l WHERE l.id = $3::uuid AND l.user_id = $2 AND l.archived_at IS NULL))
  RETURNING id`;

/** Mark or unmark an example. Not an edit, so updated_at is left alone. */
export const ARTIFACT_SET_DEMO_SQL = `UPDATE refinery_artifact SET is_demo = $3
  WHERE id = $1 AND user_id = $2
  RETURNING id`;

export const INTRO_LIST_SQL = `SELECT lane_key, tool, dismissed_at FROM lane_tool_intro WHERE user_id = $1`;

export const INTRO_DISMISS_SQL = `INSERT INTO lane_tool_intro (user_id, lane_key, tool)
  VALUES ($1, $2, $3)
  ON CONFLICT (user_id, lane_key, tool) DO NOTHING`;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

export async function listLanes(
  userId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<CareerLane[]> {
  return queryAsUser<CareerLane>(userId, LANE_LIST_SQL, [userId, opts.includeArchived === true]);
}

export async function getLane(userId: string, laneId: string): Promise<CareerLane | null> {
  return getOneAsUser<CareerLane>(userId, LANE_GET_SQL, [laneId, userId]);
}

/** An open lane of this person's, or null (missing, someone else's, archived). */
export async function getOpenLane(userId: string, laneId: string): Promise<CareerLane | null> {
  const lane = await getLane(userId, laneId);
  return lane && !lane.archived_at ? lane : null;
}

export type LaneWriteResult =
  | { status: "ok"; lane: CareerLane }
  | { status: "invalid"; error: LaneSettingsError }
  | { status: "duplicate_name" }
  | { status: "too_many" }
  | { status: "too_many_total" }
  | { status: "not_found" };

export async function createLane(userId: string, input: LaneSettingsInput): Promise<LaneWriteResult> {
  const settings = resolveLaneSettings(input, null);
  if (!settings.ok) return { status: "invalid", error: settings.error };
  const counts = await getOneAsUser<{ open: number; total: number }>(userId, LANE_COUNTS_SQL, [userId]);
  if ((counts?.open ?? 0) >= MAX_OPEN_LANES) return { status: "too_many" };
  if ((counts?.total ?? 0) >= MAX_TOTAL_LANES) return { status: "too_many_total" };
  const v = settings.value;
  try {
    const rows = await queryAsUser<CareerLane>(userId, LANE_INSERT_SQL, [
      userId, v.name, v.target_role, v.format, v.hybrid_uneven_history, v.hybrid_field_change, v.length_pref,
    ]);
    return rows[0] ? { status: "ok", lane: rows[0] } : { status: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    throw err;
  }
}

export async function updateLane(
  userId: string,
  laneId: string,
  input: LaneSettingsInput
): Promise<LaneWriteResult> {
  const current = await getLane(userId, laneId);
  if (!current) return { status: "not_found" };
  const settings = resolveLaneSettings(input, current);
  if (!settings.ok) return { status: "invalid", error: settings.error };
  const v = settings.value;
  try {
    const rows = await queryAsUser<CareerLane>(userId, LANE_UPDATE_SQL, [
      laneId, userId, v.name, v.target_role, v.format, v.hybrid_uneven_history, v.hybrid_field_change, v.length_pref,
    ]);
    return rows[0] ? { status: "ok", lane: rows[0] } : { status: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    throw err;
  }
}

/** Archive (true) or bring back (false). Never deletes. */
export async function setLaneArchived(
  userId: string,
  laneId: string,
  archived: boolean
): Promise<LaneWriteResult> {
  if (!archived) {
    const counts = await getOneAsUser<{ open: number }>(userId, LANE_COUNTS_SQL, [userId]);
    if ((counts?.open ?? 0) >= MAX_OPEN_LANES) return { status: "too_many" };
  }
  try {
    const rows = await queryAsUser<CareerLane>(userId, LANE_ARCHIVE_SQL, [laneId, userId, archived]);
    return rows[0] ? { status: "ok", lane: rows[0] } : { status: "not_found" };
  } catch (err) {
    // Bringing back a lane whose name an open lane now uses.
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    throw err;
  }
}

/**
 * The first finished Forge resume becomes the person's first lane, named from
 * their target. Returns the new lane, or null when there is no target or the
 * person has had a lane before (they already chose how to organise).
 */
export async function ensureFirstLane(userId: string, target: unknown): Promise<CareerLane | null> {
  const name = laneNameFromTarget(target);
  if (!name) return null;
  const rows = await queryAsUser<CareerLane>(userId, LANE_ENSURE_FIRST_SQL, [
    userId, name, cleanTargetRole(target),
  ]);
  return rows[0] ?? null;
}

/** Move an artifact into a lane, or back to main with null. False when refused. */
export async function setArtifactLane(
  userId: string,
  artifactId: string,
  laneId: string | null
): Promise<boolean> {
  const rows = await queryAsUser(userId, ARTIFACT_SET_LANE_SQL, [artifactId, userId, laneId]);
  return rows.length > 0;
}

export async function setArtifactDemo(userId: string, artifactId: string, isDemo: boolean): Promise<boolean> {
  const rows = await queryAsUser(userId, ARTIFACT_SET_DEMO_SQL, [artifactId, userId, isDemo === true]);
  return rows.length > 0;
}

export async function listDismissedIntros(
  userId: string
): Promise<{ lane_key: string; tool: LaneTool; dismissed_at: string }[]> {
  return queryAsUser<{ lane_key: string; tool: LaneTool; dismissed_at: string }>(userId, INTRO_LIST_SQL, [userId]);
}

/** The open lane holding the person's newest resume, or null for main. */
export async function laneOfNewestResume(userId: string): Promise<string | null> {
  const row = await getOneAsUser<{ lane_id: string | null }>(userId, LANE_OF_NEWEST_RESUME_SQL, [userId]);
  return row?.lane_id ?? null;
}

export async function dismissIntro(userId: string, laneKeyValue: string, tool: LaneTool): Promise<void> {
  await queryAsUser(userId, INTRO_DISMISS_SQL, [userId, laneKeyValue, tool]);
}
