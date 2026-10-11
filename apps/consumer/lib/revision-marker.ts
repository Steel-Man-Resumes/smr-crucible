/**
 * The marker the server writes into an artifact's content when it rebuilt
 * that content from a saved revision (Phase 5 lane R1): "this is revision
 * <id>, exactly", with a hash of the content it was written with. Any later
 * change to the content breaks the hash, so the marker only ever vouches for
 * content the server wrote. Server only.
 */

import { createHash } from "node:crypto";
import { stableJson } from "@crucible/core/src/artifactRevision";

/** The key the server-written marker lives under in an artifact's content. */
export const REVISION_MARKER_KEY = "_revision";

/** Hash of an artifact's content without its marker (key order does not matter). */
export function contentMarkerHash(content: Record<string, unknown>): string {
  const { [REVISION_MARKER_KEY]: _omit, ...rest } = content ?? {};
  void _omit;
  return createHash("sha256").update(stableJson(rest)).digest("hex");
}

/** Content plus a marker saying "this is revision <id>, exactly". */
export function withRevisionMarker(content: Record<string, unknown>, revisionId: string): Record<string, unknown> {
  const { [REVISION_MARKER_KEY]: _omit, ...rest } = content ?? {};
  void _omit;
  return { ...rest, [REVISION_MARKER_KEY]: { id: revisionId, hash: contentMarkerHash(rest) } };
}

