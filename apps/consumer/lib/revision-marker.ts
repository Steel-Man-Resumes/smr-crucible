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

/** What a marker says about the content it sits in. */
export interface RevisionMarker {
  id: string;
  hash: string;
  /** The content as printed when the marker was written (the patch's "before"). */
  formatted?: string;
  /**
   * "finish": the server wrote this content from a finish-page revision.
   * "edit": the person's own Refinery content, saved as revision `id`.
   * "derived": the server built this content from the run's earlier inputs
   * (the Forge save, before any finish); id is "" (no revision behind it).
   */
  kind?: "finish" | "edit" | "derived";
}

/** Content plus a marker saying "this is revision <id>, exactly". */
export function withRevisionMarker(
  content: Record<string, unknown>,
  revisionId: string,
  extra: { formatted?: string; kind?: "finish" | "edit" | "derived" } = {}
): Record<string, unknown> {
  const { [REVISION_MARKER_KEY]: _omit, ...rest } = content ?? {};
  void _omit;
  const marker: RevisionMarker = { id: revisionId, hash: contentMarkerHash(rest), ...extra };
  return { ...rest, [REVISION_MARKER_KEY]: marker };
}

/** The marker in a content, read loosely (it can be stale or hand-made; hashOk says whether it still vouches). */
export function readMarker(content: unknown): (RevisionMarker & { hashOk: boolean }) | null {
  if (!content || typeof content !== "object") return null;
  const c = content as Record<string, unknown>;
  const m = c[REVISION_MARKER_KEY] as Partial<RevisionMarker> | undefined;
  if (!m || typeof m !== "object" || typeof m.id !== "string" || typeof m.hash !== "string") return null;
  return {
    id: m.id,
    hash: m.hash,
    ...(typeof m.formatted === "string" ? { formatted: m.formatted } : {}),
    ...(m.kind === "finish" || m.kind === "edit" || m.kind === "derived" ? { kind: m.kind } : {}),
    hashOk: m.hash === contentMarkerHash(c),
  };
}
