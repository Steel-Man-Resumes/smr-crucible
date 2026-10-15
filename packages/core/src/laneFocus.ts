/**
 * Today's task (migration 083): the database half. Every statement runs AS
 * the person (queryAsUser), so the owner-only policies on lane_focus decide
 * what is visible; the WHERE user_id clauses are a second, explicit layer.
 *
 * The SQL lives in exported constants so the scratch-database test can run
 * the exact statements against the real schema.
 */

import { queryAsUser, getOneAsUser } from "./db";
import { isLaneTask, type LaneFocus } from "./laneFocusShared";

export const LANE_FOCUS_GET_SQL = `SELECT task, lane_id, target, updated_at FROM lane_focus WHERE user_id = $1`;

/** The key is user_id, so this can only ever write the caller's own row. */
export const LANE_FOCUS_UPSERT_SQL = `INSERT INTO lane_focus (user_id, lane_id, task, target, updated_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (user_id) DO UPDATE SET lane_id = EXCLUDED.lane_id, task = EXCLUDED.task, target = EXCLUDED.target, updated_at = now()
  WHERE lane_focus.user_id = $1
  RETURNING task, lane_id, target, updated_at`;

export const LANE_FOCUS_DELETE_SQL = `DELETE FROM lane_focus WHERE user_id = $1`;

interface Row {
  task: string;
  lane_id: string | null;
  target: string | null;
  updated_at: string | null;
}

function fromRow(r: Row | null | undefined): LaneFocus | null {
  if (!r || !isLaneTask(r.task)) return null;
  return { task: r.task, laneId: r.lane_id ?? null, target: r.target ?? null, updatedAt: r.updated_at ? String(r.updated_at) : null };
}

/** Postgres "relation does not exist": 083 not applied yet. */
export function laneFocusTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "42P01" || /relation "lane_focus" does not exist/i.test(String(e?.message ?? ""));
}

/** The person's saved task, or null (none picked yet, or 083 not applied). */
export async function getLaneFocus(userId: string): Promise<LaneFocus | null> {
  try {
    return fromRow(await getOneAsUser<Row>(userId, LANE_FOCUS_GET_SQL, [userId]));
  } catch (err) {
    if (laneFocusTableMissing(err)) return null;
    throw err;
  }
}

export type SetLaneFocusResult =
  | { status: "saved"; focus: LaneFocus }
  | { status: "bad_lane" }
  | { status: "not_ready" };

/** Save today's task. A lane id that is not the person's own is refused by the composite key. */
export async function setLaneFocus(
  userId: string,
  focus: { task: string; laneId: string | null; target: string | null }
): Promise<SetLaneFocusResult> {
  if (!isLaneTask(focus.task)) return { status: "bad_lane" };
  try {
    const rows = await queryAsUser<Row>(userId, LANE_FOCUS_UPSERT_SQL, [userId, focus.laneId, focus.task, focus.target]);
    const saved = fromRow(rows[0]);
    return saved ? { status: "saved", focus: saved } : { status: "not_ready" };
  } catch (err) {
    if (laneFocusTableMissing(err)) return { status: "not_ready" };
    // 23503: the lane is not one this person holds (composite foreign key).
    if ((err as { code?: string })?.code === "23503") return { status: "bad_lane" };
    throw err;
  }
}

/** For "delete my data": the row goes, AS the person. Missing table: nothing to delete. */
export async function deleteLaneFocus(userId: string): Promise<void> {
  try {
    await queryAsUser(userId, LANE_FOCUS_DELETE_SQL, [userId]);
  } catch (err) {
    if (!laneFocusTableMissing(err)) throw err;
  }
}
