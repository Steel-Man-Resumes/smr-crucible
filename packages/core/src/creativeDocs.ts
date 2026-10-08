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
    AND ra.artifact_type IN ('artist_resume', 'artist_bio', 'artist_statement', 'work_sample_list')
  ORDER BY ra.artifact_type, ra.updated_at DESC, ra.created_at DESC`;

/** Content write for a creative document. Only this module sends it. */
export const CREATIVE_DOC_UPDATE_SQL = `UPDATE refinery_artifact
  SET content = $1::jsonb, updated_at = now()
  WHERE id = $2 AND user_id = $3 AND artifact_type = $4 AND is_locked = false
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
export async function saveCreativeDoc(
  userId: string,
  laneId: string,
  type: CreativeArtifactType,
  content: Record<string, unknown>,
  targetContext: Record<string, unknown> = {}
): Promise<RefineryArtifact | null> {
  const existing = await getCreativeDoc(userId, laneId, type);
  if (existing) {
    const rows = await queryAsUser<RefineryArtifact>(userId, CREATIVE_DOC_UPDATE_SQL, [JSON.stringify(content), existing.id, userId, type]);
    return rows[0] ?? null;
  }
  return createArtifact(userId, type, targetContext, content, 1.0, { laneId });
}
