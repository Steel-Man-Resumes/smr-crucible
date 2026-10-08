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
import { CREATIVE_TYPES_SQL } from "./refineryArtifact";
import {
  MAX_OPEN_LANES,
  MAX_TOTAL_LANES,
  laneNameFromTarget,
  cleanTargetRole,
  resolveLaneSettings,
  isUuid,
  isLanePath,
  type LanePath,
  type CareerLane,
  type LaneSettingsInput,
  type LaneSettingsError,
  type LaneTool,
} from "./careerLaneShared";

export * from "./careerLaneShared";

const LANE_COLUMNS = `id, user_id, name, target_role, format, hybrid_uneven_history, hybrid_field_change,
  length_pref, created_at, updated_at, archived_at, is_first, kind, path, pair_lane_id, kind_settings, pair_plan`;

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
  (user_id, name, target_role, format, hybrid_uneven_history, hybrid_field_change, length_pref, kind, path)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING ${LANE_COLUMNS}`;

/**
 * Settings update. The kind never changes here (set once, at create). The
 * path changes only while the lane is not in a pair: inside a pair the paths
 * are set together by LANE_PAIR_SQL, and the database refuses a pair whose
 * paths match.
 */
export const LANE_UPDATE_SQL = `UPDATE career_lane
  SET name = $3, target_role = $4, format = $5, hybrid_uneven_history = $6,
      hybrid_field_change = $7, length_pref = $8,
      path = CASE WHEN pair_lane_id IS NULL THEN $9::text ELSE path END,
      updated_at = now()
  WHERE id = $1 AND user_id = $2
  RETURNING ${LANE_COLUMNS}`;

/**
 * Pair two open lanes of one person in ONE statement: $1 takes path $4, $2
 * takes the other path, and each points at the other. Neither may already be
 * in a pair. Returns both rows, or none when refused. The composite key and
 * the deferred pair trigger (075) hold the same rules in the database.
 */
export const LANE_PAIR_SQL = `UPDATE career_lane l
  SET pair_lane_id = CASE WHEN l.id = $1::uuid THEN $2::uuid ELSE $1::uuid END,
      path = CASE WHEN l.id = $1::uuid THEN $4::text
                  ELSE (CASE WHEN $4::text = 'dream' THEN 'realistic' ELSE 'dream' END) END,
      updated_at = now()
  WHERE l.user_id = $3 AND l.id IN ($1::uuid, $2::uuid) AND $1::uuid <> $2::uuid
    AND $4::text IN ('realistic', 'dream')
    AND (SELECT COUNT(*) FROM career_lane c
          WHERE c.user_id = $3 AND c.id IN ($1::uuid, $2::uuid)
            AND c.archived_at IS NULL AND c.pair_lane_id IS NULL) = 2
  RETURNING ${LANE_COLUMNS.split(", ").map((c) => "l." + c.trim()).join(", ")}`;

/** Unpair: both sides in one statement. The plan card stays on the dream lane. */
export const LANE_UNPAIR_SQL = `UPDATE career_lane
  SET pair_lane_id = NULL, updated_at = now()
  WHERE user_id = $2 AND (id = $1 OR pair_lane_id = $1) AND pair_lane_id IS NOT NULL
  RETURNING ${LANE_COLUMNS}`;

/** The pair's plan card, kept on the dream lane of a live pair only. */
export const LANE_SET_PLAN_SQL = `UPDATE career_lane
  SET pair_plan = $3::jsonb, updated_at = now()
  WHERE id = $1 AND user_id = $2 AND path = 'dream' AND pair_lane_id IS NOT NULL
  RETURNING ${LANE_COLUMNS}`;

/** Per-lane choices for a non-resume kind. Choices only; facts live in the record. */
export const LANE_SET_KIND_SETTINGS_SQL = `UPDATE career_lane
  SET kind_settings = $3::jsonb, updated_at = now()
  WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
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
    AND artifact_type NOT IN (${CREATIVE_TYPES_SQL})
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

/** Postgres check_violation (also what the pair trigger raises). */
function isCheckViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23514";
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
  | { status: "in_pair" }
  | { status: "has_plan" }
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
      userId, v.name, v.target_role, v.format, v.hybrid_uneven_history, v.hybrid_field_change, v.length_pref, v.kind, v.path,
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
  // Inside a pair the paths move together (pairLanes); refuse rather than ignore.
  if (input.path !== undefined && current.pair_lane_id && v.path !== (current.path ?? null)) {
    return { status: "in_pair" };
  }
  try {
    const rows = await queryAsUser<CareerLane>(userId, LANE_UPDATE_SQL, [
      laneId, userId, v.name, v.target_role, v.format, v.hybrid_uneven_history, v.hybrid_field_change, v.length_pref, v.path,
    ]);
    return rows[0] ? { status: "ok", lane: rows[0] } : { status: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate_name" };
    // A dream lane that holds a plan card cannot become realistic (075 CHECK).
    if (isCheckViolation(err)) return { status: "has_plan" };
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
  // An archived lane leaves its pair: the open lane never stays paired to it.
  if (archived) await unpairLane(userId, laneId);
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

export type LanePairResult =
  | { status: "ok"; lanes: CareerLane[] }
  | { status: "refused" };

/**
 * Pair lane `laneId` (taking `path`) with `partnerId` (taking the other path).
 * Both must be this person's, open, and in no pair yet.
 */
export async function pairLanes(
  userId: string,
  laneId: string,
  partnerId: string,
  path: LanePath
): Promise<LanePairResult> {
  if (!isUuid(laneId) || !isUuid(partnerId) || laneId === partnerId || !isLanePath(path)) return { status: "refused" };
  try {
    const rows = await queryAsUser<CareerLane>(userId, LANE_PAIR_SQL, [laneId, partnerId, userId, path]);
    return rows.length === 2 ? { status: "ok", lanes: rows } : { status: "refused" };
  } catch (err) {
    if (isCheckViolation(err) || isUniqueViolation(err)) return { status: "refused" };
    throw err;
  }
}

/** Break a pair (both sides). Returns the rows changed (0 when not paired). */
export async function unpairLane(userId: string, laneId: string): Promise<CareerLane[]> {
  if (!isUuid(laneId)) return [];
  return queryAsUser<CareerLane>(userId, LANE_UNPAIR_SQL, [laneId, userId]);
}

/** Save the pair's plan card on the dream lane. Null when not a live pair's dream lane. */
export async function setLanePlan(userId: string, dreamLaneId: string, plan: Record<string, unknown>): Promise<CareerLane | null> {
  const rows = await queryAsUser<CareerLane>(userId, LANE_SET_PLAN_SQL, [dreamLaneId, userId, JSON.stringify(plan)]);
  return rows[0] ?? null;
}

/** Save a lane's kind settings (already cleaned by the caller). */
export async function setLaneKindSettings(userId: string, laneId: string, settings: Record<string, unknown>): Promise<CareerLane | null> {
  const rows = await queryAsUser<CareerLane>(userId, LANE_SET_KIND_SETTINGS_SQL, [laneId, userId, JSON.stringify(settings)]);
  return rows[0] ?? null;
}
