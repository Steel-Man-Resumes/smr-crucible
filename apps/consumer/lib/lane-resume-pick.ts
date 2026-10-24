/**
 * Which resume stands for a lane. One rule, read by the coach context, the
 * lane home, the next-action card and progression (all through
 * loadSelectedWork's laneResume).
 *
 * It used to be simply the newest edit. A tailored copy is usually newer than
 * the base resume and often has no saved version yet, so the lane said "No
 * saved resume version" and "Start your resume" to a person holding a
 * finished resume (walk 2026-10-24, bug 9).
 *
 * Rank, best first: the latest version is finished; it has any version; it
 * has none. Ties keep the listing order (a pinned current resume first, then
 * the newest edit).
 */
export interface LaneResumeCandidate { id: string }

export function pickLaneResume<A extends LaneResumeCandidate>(
  listed: readonly A[],
  latestStatus: ReadonlyMap<string, string>
): A | null {
  const rank = (a: A) => {
    const status = latestStatus.get(a.id);
    return status === "finished" ? 0 : status ? 1 : 2;
  };
  let best: A | null = null;
  for (const a of listed) if (!best || rank(a) < rank(best)) best = a;
  return best;
}

/** The latest revision status per artifact, one query, as the person. */
export const LATEST_REVISION_STATUS_SQL = `SELECT DISTINCT ON (artifact_id) artifact_id, status
     FROM artifact_revision
     WHERE user_id = $1 AND artifact_id = ANY($2::uuid[])
     ORDER BY artifact_id, revision_number DESC`;

/** How many of a lane's resumes the pick looks at. */
export const LANE_RESUME_LOOKBACK = 20;
