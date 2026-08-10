/**
 * Refinery Artifact Persistence
 *
 * CRUD operations for the refinery_artifact table.
 * Stores resumes, disclosure plans, interview preps, etc.
 * Each artifact is versioned by iteration_number per user+type+context.
 */

import { createHash } from "node:crypto";
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
  /** R6: short career-lane label for a locked baseline resume (e.g. "Manufacturing"). */
  lane: string | null;
  /** R6: an approved, locked per-lane baseline resume. Multiple are allowed. */
  is_locked: boolean;
  /** Phase 1A: the immediate artifact this one was forked from. Null if never forked. */
  parent_artifact_id: string | null;
  /** Phase 1A: the root of this artifact's lineage (self-referential for the root itself). */
  origin_artifact_id: string | null;
  /** Phase 1A: identity fingerprint of `content`. SQL-computed (md5) for forks; see forkArtifact(). */
  content_hash: string | null;
  /** Phase 1A: when this artifact was approved. Locking IS the approval act (see lockBaseline). */
  approved_at: string | null;
  /** Phase 1A: free-text note on why this artifact/fork was created, e.g. "tailor", "correction". */
  creation_reason: string | null;
  /** Phase 1A: caller-supplied idempotency key for a fork operation. */
  operation_key: string | null;
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
 * Phase 0.1 stop-loss (2026-08-10): content writes carry `is_locked = false`
 * IN THE WRITE SQL itself, so a locked baseline can never be overwritten by
 * autosave, Forge re-sync, stale tabs, or any future caller -- regardless of
 * what the route layer checks. The full immutable-revision model lands in
 * Phase 1A; until then this predicate is the guarantee.
 *
 * Exported as a constant so the adversarial suite can assert the predicate
 * never regresses out of the statement.
 */
export const ARTIFACT_CONTENT_UPDATE_SQL = (scaffoldClause: string) =>
  `UPDATE refinery_artifact
     SET content = $1, updated_at = now()${scaffoldClause}
     WHERE id = $2 AND user_id = $3 AND is_locked = false
     RETURNING *`;

export const ARTIFACT_DELETE_SQL = `DELETE FROM refinery_artifact
     WHERE id = $1 AND user_id = $2 AND is_locked = false
     RETURNING id`;

export type ArtifactWriteResult =
  | { status: "updated"; artifact: RefineryArtifact }
  | { status: "locked" }
  | { status: "not_found" };

/**
 * Update an existing artifact in place. Ownership-checked, lock-guarded.
 * A locked artifact is never written; the caller gets a discriminated
 * result and decides how to surface it.
 */
export async function updateArtifact(
  artifactId: string,
  userId: string,
  content: Record<string, unknown>,
  scaffoldLevel?: number
): Promise<ArtifactWriteResult> {
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
    ARTIFACT_CONTENT_UPDATE_SQL(scaffoldClause),
    params
  );
  if (rows[0]) return { status: "updated", artifact: rows[0] };
  // Zero rows: distinguish a locked row from a missing/foreign one.
  const existing = await getOne<{ is_locked: boolean }>(
    `SELECT is_locked FROM refinery_artifact WHERE id = $1 AND user_id = $2`,
    [artifactId, userId]
  );
  return existing ? { status: "locked" } : { status: "not_found" };
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
 * Delete an artifact. Ownership-checked, lock-guarded (Phase 0.1): a locked
 * baseline must be explicitly unlocked before it can be deleted. Account-level
 * data deletion bypasses this by design (it deletes by user_id directly).
 */
export async function deleteArtifact(
  artifactId: string,
  userId: string
): Promise<"deleted" | "locked" | "not_found"> {
  const rows = await query(ARTIFACT_DELETE_SQL, [artifactId, userId]);
  if (rows.length > 0) return "deleted";
  const existing = await getOne<{ is_locked: boolean }>(
    `SELECT is_locked FROM refinery_artifact WHERE id = $1 AND user_id = $2`,
    [artifactId, userId]
  );
  return existing ? "locked" : "not_found";
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
 * R6: lock a resume as an approved per-lane BASELINE, optionally labeling its
 * career lane. Multiple locked baselines are allowed (one per lane), unlike the
 * single is_current pin. Locking is not an edit, so updated_at is left untouched
 * (the vault keeps its order). A null/omitted lane keeps any existing label.
 * Ownership + resume-type checked; returns false if it isn't this user's resume.
 */
export async function lockBaseline(
  userId: string,
  artifactId: string,
  lane?: string | null
): Promise<boolean> {
  const cleanLane =
    typeof lane === "string" && lane.trim() ? lane.trim().slice(0, 60) : null;
  const rows = await query(
    `UPDATE refinery_artifact
       SET is_locked = true, lane = COALESCE($3, lane),
           approved_at = COALESCE(approved_at, now())
     WHERE id = $1 AND user_id = $2 AND artifact_type = 'resume'
     RETURNING id`,
    [artifactId, userId, cleanLane]
  );
  return rows.length > 0;
}

/** R6: unlock a baseline resume (leaves its lane label in place). */
export async function unlockBaseline(
  userId: string,
  artifactId: string
): Promise<boolean> {
  const rows = await query(
    `UPDATE refinery_artifact
       SET is_locked = false
     WHERE id = $1 AND user_id = $2 AND artifact_type = 'resume'
     RETURNING id`,
    [artifactId, userId]
  );
  return rows.length > 0;
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

/**
 * App-level content fingerprint. Deterministic sha256 hex of
 * JSON.stringify(content) -- no key-order canonicalization beyond what
 * JSON.stringify already does for a given object shape. Used by
 * application_document snapshots (applicationEvents.ts), where the hash is
 * computed in Node before the INSERT.
 *
 * NOT used for fork lineage: forkArtifact() below copies `content` inside a
 * single SQL statement and computes its hash with Postgres's md5(content::text)
 * instead, because there is no round trip through Node to hash with. The two
 * hashes are different algorithms over similar-but-not-identical serializations
 * (JSON.stringify vs. Postgres's jsonb text cast) and are never compared to
 * each other -- each is only ever compared against another hash produced the
 * same way.
 */
export function hashContent(content: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export type ForkResult =
  | { status: "forked"; artifact: RefineryArtifact; deduped: boolean }
  | { status: "not_found" };

/**
 * Phase 1A: fork a successor artifact from a source artifact. Immutable-revision
 * doctrine -- this never edits the source in place. The new row copies the
 * source's content verbatim in a single INSERT..SELECT (atomic; never a
 * read-then-insert of the content, so there is no window where the app holds
 * a stale copy of `content` between reading it and writing the fork).
 *
 * Lineage: parent_artifact_id = source.id. origin_artifact_id is the root of
 * the whole chain: COALESCE(source.origin_artifact_id, source.id), so forking
 * a fork still points straight at the original root.
 *
 * The fork starts unlocked, unpinned, and lane-less (is_locked / is_current /
 * lane are NOT copied) -- a fork is a fresh draft, not a second approved
 * baseline. iteration_number is source + 1.
 *
 * content_hash is computed in SQL with md5(content::text) as part of the same
 * INSERT..SELECT, since the copy never passes through Node -- see hashContent()'s
 * comment above for why this is a deliberately different hash from the
 * app-level sha256 used elsewhere.
 *
 * operationKey dedupe: when supplied, a concurrent duplicate fork request for
 * the same (user, parent, operationKey) is a no-op at the DB level (the
 * partial unique index + ON CONFLICT ... DO NOTHING) and this function returns
 * the ALREADY-EXISTING fork with deduped: true instead of creating a second one.
 */
/**
 * Exported so the adversarial suite can assert the fork contract never
 * regresses without touching the DB: ownership-scoped SELECT, is_locked /
 * is_current / lane NOT copied (a fork is a fresh draft, not a second
 * approved baseline), origin_artifact_id COALESCE keeps a forked fork
 * pointed at the root, and the operationKey dedupe is ON CONFLICT DO NOTHING.
 */
export const ARTIFACT_FORK_SQL = `INSERT INTO refinery_artifact (
       user_id, artifact_type, target_context, content,
       iteration_number, scaffold_level,
       parent_artifact_id, origin_artifact_id, content_hash,
       creation_reason, operation_key
     )
     SELECT
       src.user_id,
       src.artifact_type,
       COALESCE($3::jsonb, src.target_context),
       src.content,
       src.iteration_number + 1,
       src.scaffold_level,
       src.id,
       COALESCE(src.origin_artifact_id, src.id),
       md5(src.content::text),
       $4,
       $5
     FROM refinery_artifact src
     WHERE src.id = $1 AND src.user_id = $2
     ON CONFLICT (user_id, parent_artifact_id, operation_key) WHERE operation_key IS NOT NULL
       DO NOTHING
     RETURNING *`;

export async function forkArtifact(opts: {
  userId: string;
  sourceArtifactId: string;
  reason: string;
  operationKey?: string | null;
  targetContext?: Record<string, unknown> | null;
}): Promise<ForkResult> {
  const { userId, sourceArtifactId, reason, targetContext } = opts;
  const operationKey = opts.operationKey ?? null;

  const rows = await query<RefineryArtifact>(ARTIFACT_FORK_SQL, [
    sourceArtifactId,
    userId,
    targetContext ? JSON.stringify(targetContext) : null,
    reason,
    operationKey,
  ]);

  if (rows[0]) return { status: "forked", artifact: rows[0], deduped: false };

  // Zero rows: either the source didn't exist/wasn't owned by this user, or
  // an operationKey collided with an existing fork (ON CONFLICT DO NOTHING).
  if (operationKey) {
    const existing = await getOne<RefineryArtifact>(
      `SELECT * FROM refinery_artifact
       WHERE user_id = $1 AND parent_artifact_id = $2 AND operation_key = $3`,
      [userId, sourceArtifactId, operationKey]
    );
    if (existing) return { status: "forked", artifact: existing, deduped: true };
  }
  return { status: "not_found" };
}
