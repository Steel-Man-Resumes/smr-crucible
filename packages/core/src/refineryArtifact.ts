/**
 * Refinery Artifact Persistence
 *
 * CRUD operations for the refinery_artifact table.
 * Stores resumes, disclosure plans, interview preps, etc.
 * Each artifact is versioned by iteration_number per user+type+context.
 */

import { query, getOne, insert } from "./db";

export interface RefineryArtifact {
  id: string;
  user_id: string;
  artifact_type: string;
  target_context: Record<string, unknown>;
  content: Record<string, unknown>;
  file_id: string | null;
  iteration_number: number;
  scaffold_level: number;
  /** N4: the user's one pinned "current" resume (at most one per user). */
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export type ArtifactType =
  | "resume"
  | "cover_letter"
  | "follow_up"
  | "disclosure_plan"
  | "interview_prep"
  | "resource_list"
  | "job_match";

/**
 * Create a new artifact. Iteration number auto-increments per user+type.
 */
export async function createArtifact(
  userId: string,
  type: ArtifactType,
  targetContext: Record<string, unknown>,
  content: Record<string, unknown>,
  scaffoldLevel: number = 1.0
): Promise<RefineryArtifact> {
  // Get next iteration number for this user+type combo
  const latest = await getOne<{ max_iter: number }>(
    `SELECT COALESCE(MAX(iteration_number), 0) AS max_iter
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type = $2`,
    [userId, type]
  );
  const nextIter = (latest?.max_iter ?? 0) + 1;

  return insert<RefineryArtifact>("refinery_artifact", {
    user_id: userId,
    artifact_type: type,
    target_context: JSON.stringify(targetContext),
    content: JSON.stringify(content),
    iteration_number: nextIter,
    scaffold_level: scaffoldLevel,
  });
}

/**
 * Update an existing artifact in place. Ownership-checked.
 */
export async function updateArtifact(
  artifactId: string,
  userId: string,
  content: Record<string, unknown>,
  scaffoldLevel?: number
): Promise<RefineryArtifact | null> {
  const scaffoldClause = scaffoldLevel !== undefined
    ? `, scaffold_level = $4`
    : "";
  const params: unknown[] = [
    JSON.stringify(content),
    artifactId,
    userId,
  ];
  if (scaffoldLevel !== undefined) {
    params.push(scaffoldLevel);
  }

  const rows = await query<RefineryArtifact>(
    `UPDATE refinery_artifact
     SET content = $1, updated_at = now()${scaffoldClause}
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/**
 * Get a single artifact by ID. Ownership-checked.
 */
export async function getArtifact(
  artifactId: string,
  userId: string
): Promise<RefineryArtifact | null> {
  return getOne<RefineryArtifact>(
    `SELECT * FROM refinery_artifact
     WHERE id = $1 AND user_id = $2`,
    [artifactId, userId]
  );
}

/**
 * List artifacts for a user, optionally filtered by type.
 */
export async function listArtifacts(
  userId: string,
  opts?: { type?: ArtifactType; limit?: number }
): Promise<RefineryArtifact[]> {
  const typeClause = opts?.type ? ` AND artifact_type = $2` : "";
  const limit = opts?.limit ?? 50;
  const params: unknown[] = [userId];
  if (opts?.type) params.push(opts.type);
  params.push(limit);

  return query<RefineryArtifact>(
    `SELECT * FROM refinery_artifact
     WHERE user_id = $1${typeClause}
     ORDER BY updated_at DESC
     LIMIT $${params.length}`,
    params
  );
}

/**
 * Delete an artifact. Ownership-checked.
 */
export async function deleteArtifact(
  artifactId: string,
  userId: string
): Promise<boolean> {
  const rows = await query(
    `DELETE FROM refinery_artifact
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [artifactId, userId]
  );
  return rows.length > 0;
}

/**
 * Pin ONE resume as the user's current resume (N4). Clears any prior pin first,
 * so the partial unique index (one current per user) is never transiently
 * violated by the neon HTTP driver's per-statement execution. If the two writes
 * are interrupted between, the state is "no current resume" -- valid, never an
 * error. Returns false if the artifact isn't this user's resume.
 */
export async function setCurrentResume(
  userId: string,
  artifactId: string
): Promise<boolean> {
  const target = await getOne<{ id: string }>(
    `SELECT id FROM refinery_artifact
     WHERE id = $1 AND user_id = $2 AND artifact_type = 'resume'`,
    [artifactId, userId]
  );
  if (!target) return false;
  // Clear the old pin first (does not touch updated_at -- pinning is not an edit).
  await query(
    `UPDATE refinery_artifact SET is_current = false WHERE user_id = $1 AND is_current`,
    [userId]
  );
  await query(
    `UPDATE refinery_artifact SET is_current = true WHERE id = $1 AND user_id = $2`,
    [artifactId, userId]
  );
  return true;
}

/** Unpin the user's current resume (if any). */
export async function clearCurrentResume(userId: string): Promise<void> {
  await query(
    `UPDATE refinery_artifact SET is_current = false WHERE user_id = $1 AND is_current`,
    [userId]
  );
}

/**
 * Get artifact counts grouped by type for a user.
 */
export async function getArtifactCounts(
  userId: string
): Promise<Record<string, number>> {
  const rows = await query<{ artifact_type: string; count: string }>(
    `SELECT artifact_type, COUNT(*)::text AS count
     FROM refinery_artifact
     WHERE user_id = $1
     GROUP BY artifact_type`,
    [userId]
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.artifact_type] = parseInt(row.count, 10);
  }
  return counts;
}
