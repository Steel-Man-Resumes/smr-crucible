/**
 * Creative lane documents: the database half. One row per lane per document
 * type in refinery_artifact (the newest wins), written only here. Every
 * statement runs AS the person, under the owner-only policies.
 *
 * The routes run the checks BEFORE calling these (the statement guard, the
 * bio trace); the generic artifact write refuses these types, so this is the
 * one way in.
 */

import { queryAsUser, getOneAsUser } from "./db";
import { createArtifact, CREATIVE_ARTIFACT_TYPES, type CreativeArtifactType, type RefineryArtifact } from "./refineryArtifact";

/** A document's revision number (content.rev), 0 for none. Null when there is no document. */
export function revOf(doc: { content?: unknown } | null | undefined): number | null {
  if (!doc) return null;
  const r = Number((doc.content as { rev?: unknown } | null)?.rev ?? 0);
  return Number.isInteger(r) && r >= 0 ? r : 0;
}

export function isCreativeArtifactType(v: unknown): v is CreativeArtifactType {
  return typeof v === "string" && (CREATIVE_ARTIFACT_TYPES as readonly string[]).includes(v);
}

/** The newest document of a type in a lane. The lane must be the person's own. */
export const CREATIVE_DOC_GET_SQL = `SELECT ra.* FROM refinery_artifact ra
  JOIN career_lane l ON l.id = ra.lane_id AND l.user_id = ra.user_id
  WHERE ra.user_id = $1 AND ra.lane_id = $2 AND ra.artifact_type = $3
  ORDER BY ra.updated_at DESC, ra.created_at DESC
  LIMIT 1`;

/** Every creative document in a lane, newest per type first. */
export const CREATIVE_DOCS_IN_LANE_SQL = `SELECT DISTINCT ON (ra.artifact_type) ra.* FROM refinery_artifact ra
  WHERE ra.user_id = $1 AND ra.lane_id = $2
    AND ra.artifact_type IN ('artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list', 'cv')
  ORDER BY ra.artifact_type, ra.updated_at DESC, ra.created_at DESC`;

/** Content write for a creative document. Only this module sends it. */
export const CREATIVE_DOC_UPDATE_SQL = `UPDATE refinery_artifact
  SET content = $1::jsonb, updated_at = now()
  WHERE id = $2 AND user_id = $3 AND artifact_type = $4 AND is_locked = false
    AND COALESCE((content->>'rev')::int, 0) = $5::int
  RETURNING *`;

export async function getCreativeDoc(userId: string, laneId: string, type: CreativeArtifactType): Promise<RefineryArtifact | null> {
  return getOneAsUser<RefineryArtifact>(userId, CREATIVE_DOC_GET_SQL, [userId, laneId, type]);
}

export async function listCreativeDocs(userId: string, laneId: string): Promise<RefineryArtifact[]> {
  return queryAsUser<RefineryArtifact>(userId, CREATIVE_DOCS_IN_LANE_SQL, [userId, laneId]);
}

/**
 * Save a lane's document: update the newest one, or make the first. The
 * caller has checked the lane is this person's, open, and a creative lane,
 * and has run the document's own checks on `content`.
 */
export type SaveDocResult = { status: "ok"; doc: RefineryArtifact } | { status: "changed_elsewhere" };

/**
 * `readRev`: the revision of the copy the caller read (null when it read
 * none). The write lands only if nobody saved in between, so two tabs (or a
 * slow request) never silently drop each other's versions. Each save bumps
 * content.rev by one.
 */
export async function saveCreativeDoc(
  userId: string,
  laneId: string,
  type: CreativeArtifactType,
  content: Record<string, unknown>,
  readRev: number | null
): Promise<SaveDocResult> {
  const existing = await getCreativeDoc(userId, laneId, type);
  if (existing) {
    if (readRev === null) return { status: "changed_elsewhere" };
    const rows = await queryAsUser<RefineryArtifact>(userId, CREATIVE_DOC_UPDATE_SQL, [
      JSON.stringify({ ...content, rev: readRev + 1 }), existing.id, userId, type, readRev,
    ]);
    return rows[0] ? { status: "ok", doc: rows[0] } : { status: "changed_elsewhere" };
  }
  if (readRev !== null) return { status: "changed_elsewhere" };
  return { status: "ok", doc: await createArtifact(userId, type, {}, { ...content, rev: 1 }, 1.0, { laneId }) };
}
