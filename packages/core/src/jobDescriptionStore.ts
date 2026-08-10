/**
 * Phase 3.2: JD snapshot read-back.
 *
 * The ownership-scoped reader for the jd_* snapshot columns written at save
 * time (see jobDescription.ts + migration 038). Phase 3.4 fit-check and
 * interview auto-fill are the consumers -- they are wired in later phases; this
 * pass only provides the reader so those consumers have a single canonical
 * source to read from.
 */

import { getOne } from "./db";
import type { JdSnapshot } from "./jobDescription";

/**
 * Return the seven jd_* snapshot fields for one application, scoped to its
 * owner. Returns null when the application does not exist or is not owned by
 * userId (never leaks another user's snapshot). A saved-but-never-snapshotted
 * row returns all-null fields with jd_truncated false.
 */
export async function getJdSnapshot(
  userId: string,
  applicationId: string
): Promise<JdSnapshot | null> {
  const row = await getOne<JdSnapshot>(
    `SELECT jd_full_text, jd_excerpt, jd_source_url, jd_source_provider,
            jd_fetched_at, jd_hash, jd_truncated
       FROM job_application
      WHERE id = $1 AND user_id = $2`,
    [applicationId, userId]
  );
  if (!row) return null;
  return {
    jd_full_text: row.jd_full_text ?? null,
    jd_excerpt: row.jd_excerpt ?? null,
    jd_source_url: row.jd_source_url ?? null,
    jd_source_provider: row.jd_source_provider ?? null,
    jd_fetched_at: row.jd_fetched_at ?? null,
    jd_hash: row.jd_hash ?? null,
    jd_truncated: row.jd_truncated ?? false,
  };
}
