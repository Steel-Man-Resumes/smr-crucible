/**
 * Which saved revision IS this artifact right now (Phase 5 lane R1)? Server only.
 *
 * Every Refinery export (download, print, quick-apply) goes through a saved
 * revision. For an artifact, that is:
 *   - its newest revision, when the artifact's content is still what that
 *     revision says: either the server wrote the content from it (a marker
 *     with a hash of exactly that content, set by saveFinishRevision), or the
 *     content prints to exactly the revision's text;
 *   - otherwise a NEW revision of the content as stored, made by the server
 *     on top of the newest one (evidence carried over, gate and pages run
 *     again). With no earlier revision that is a draft: raw text is never
 *     finished.
 * The text always comes from the stored artifact, never from the request.
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { REVISION_MARKER_KEY, contentMarkerHash } from "./revision-marker";
export { REVISION_MARKER_KEY, contentMarkerHash, withRevisionMarker } from "./revision-marker";
import { formatResumeDownload, type AnyResumeDocument } from "../components/resume/resumeModel";
import { saveEditRevision, type RevisionStore, type SaveResult } from "./revision-save";

/** The resume text an artifact's stored content prints to (empty when it is not a resume document). */
export function artifactText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (typeof c.contact !== "object" || !Array.isArray(c.experience)) return "";
  try {
    return formatResumeDownload(c as unknown as AnyResumeDocument);
  } catch {
    return "";
  }
}

/** Is the newest revision exactly what the artifact holds now? */
export function revisionIsCurrent(content: unknown, rev: Pick<ArtifactRevision, "id" | "resume_text" | "letter_text">, letterText?: string): boolean {
  if (letterText !== undefined && letterText !== rev.letter_text) return false;
  const c = (content ?? {}) as Record<string, unknown>;
  const m = c[REVISION_MARKER_KEY] as { id?: unknown; hash?: unknown } | undefined;
  if (m && m.id === rev.id && m.hash === contentMarkerHash(c)) return true;
  const text = artifactText(c);
  return !!text && text === rev.resume_text;
}

export type ExportRevision =
  | { ok: true; revision: ArtifactRevision; reused: boolean }
  | { ok: false; status: number; reason: string };

/** The revision an export of this artifact uses: the current one, or a new one of what is stored. */
export async function ensureExportRevision(
  userId: string,
  artifactId: string,
  store: RevisionStore,
  opts: { letterText?: string } = {}
): Promise<ExportRevision> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art) return { ok: false, status: 404, reason: "artifact not found" };
  if (art.artifact_type !== "resume") return { ok: false, status: 409, reason: "not a resume" };
  const newest = await store.getLatestRevision(userId, artifactId);
  if (newest && revisionIsCurrent(art.content, newest, opts.letterText)) return { ok: true, revision: newest, reused: true };
  const text = artifactText(art.content);
  if (!text.trim()) {
    // Not a structured resume (an older plain-text artifact): nothing to print.
    return { ok: false, status: 409, reason: "no resume text" };
  }
  const saved: SaveResult = await saveEditRevision(userId, artifactId, text, opts.letterText ?? newest?.letter_text ?? "", store);
  if (!saved.ok) return saved;
  const rev = await store.getLatestRevision(userId, artifactId);
  if (!rev || rev.id !== saved.revision.id) return { ok: false, status: 500, reason: "failed" };
  return { ok: true, revision: rev, reused: saved.revision.reused };
}
