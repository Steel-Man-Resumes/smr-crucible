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

import { currentRevisionStatus } from "./revision-status";
import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { readMarker, withRevisionMarker } from "./revision-marker";
export { REVISION_MARKER_KEY, contentMarkerHash, withRevisionMarker, readMarker } from "./revision-marker";
import { patchText, sameLineKeys } from "./revision-patch";
import { resumeTextToDocument } from "./revision-to-doc";
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

/** Is this revision exactly what the artifact holds now? */
export function revisionIsCurrent(content: unknown, rev: Pick<ArtifactRevision, "id" | "resume_text" | "letter_text">, letterText?: string): boolean {
  if (letterText !== undefined && letterText !== rev.letter_text) return false;
  const m = readMarker(content);
  if (m && m.id === rev.id && m.hashOk) return true;
  const text = artifactText(content);
  return !!text && text === rev.resume_text;
}

/**
 * The text a stored artifact stands for, given the revision it was last saved
 * as (review H1): the revision's own text with only the person's changes since
 * applied (lib/revision-patch.ts). Untouched lines keep their exact saved form,
 * so formatting alone never reopens an answered line.
 */
export function textFromBase(content: unknown, base: Pick<ArtifactRevision, "id" | "resume_text"> & { evidence?: unknown }): string {
  const now = artifactText(content);
  if (!now) return "";
  const m = readMarker(content);
  // The printing of the content as it was when saved: the marker carries it;
  // otherwise the saved text's own document, printed.
  const before = m && m.id === base.id && typeof m.formatted === "string" ? m.formatted : artifactText(resumeTextToDocument(base.resume_text));
  // Lines the person already settled: the saved text and the writer's documents.
  const w = ((base.evidence ?? {}) as { written?: { resume?: unknown; letter?: unknown } | null }).written;
  const known = [w?.resume, w?.letter].filter((x): x is string => typeof x === "string").flatMap((t) => t.split("\n"));
  const patched = patchText(base.resume_text, before, now, known);
  // Invariant (review H-A): the patched text must print the same lines as the
  // editor. If it does not (a field the patch could not map back), the
  // editor's own text is used and the gate decides: never a file holding
  // lines the person removed.
  return sameLineKeys(artifactText(resumeTextToDocument(patched)), now) ? patched : now;
}

/** Most parents walked to find a revision to start from (a fork of a fork...). */
const MAX_PARENT_HOPS = 5;

/**
 * The revision an artifact's next version starts from: its own newest, or,
 * for a Tailor output or fork with none yet, its parent's newest (review M3).
 * Read AS the person, so only their own artifacts count.
 */
export async function baseRevisionFor(
  userId: string,
  art: { id: string; parent_artifact_id?: string | null },
  store: RevisionStore
): Promise<ArtifactRevision | null> {
  const own = await store.getLatestRevision(userId, art.id);
  if (own) return own;
  let parentId = art.parent_artifact_id ?? null;
  for (let hop = 0; parentId && hop < MAX_PARENT_HOPS; hop++) {
    const rev = await store.getLatestRevision(userId, parentId);
    if (rev) return rev;
    const parent = await store.getArtifact(userId, parentId);
    parentId = parent?.parent_artifact_id ?? null;
  }
  return null;
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
  if (newest && revisionIsCurrent(art.content, newest, opts.letterText)) return { ok: true, revision: currentRevisionStatus(newest), reused: true };
  const marker = readMarker(art.content);
  if (newest && !art.is_locked && marker?.hashOk && (marker.kind === "finish" || marker.kind === "derived") && marker.id !== newest.id &&
      (newest.source === "forge_finish" || newest.source === "forge_import")) {
    const doc = resumeTextToDocument(newest.resume_text, art.content as AnyResumeDocument) as unknown as Record<string, unknown>;
    const wrote = await store.updateArtifactContent(userId, artifactId,
      withRevisionMarker(doc, newest.id, { formatted: artifactText(doc), kind: "finish" }), art.content).catch(() => "failed");
    if (wrote !== "updated") return { ok: false, status: 503, reason: "working_copy_not_saved" };
    if (opts.letterText === undefined || opts.letterText === newest.letter_text) return { ok: true, revision: currentRevisionStatus(newest), reused: true };
    art.content = withRevisionMarker(doc, newest.id, { formatted: artifactText(doc), kind: "finish" });
  }
  if (!artifactText(art.content).trim()) {
    // Not a structured resume (an older plain-text artifact): nothing to print.
    return { ok: false, status: 409, reason: "no resume text" };
  }
  const base = newest ?? (await baseRevisionFor(userId, art, store));
  // An unchanged copy of the base (a fork carries its parent's marker) is the base's text exactly.
  const text = base ? textFromBase(art.content, base) : artifactText(art.content);
  const saved: SaveResult = await saveEditRevision(userId, artifactId, text, opts.letterText ?? base?.letter_text ?? "", store, { base });
  if (!saved.ok) return saved;
  const rev = await store.getLatestRevision(userId, artifactId);
  if (!rev || rev.id !== saved.revision.id) return { ok: false, status: 500, reason: "failed" };
  // The stored content is now exactly this revision: mark it, with its printing,
  // so the next export reuses it and the next edit patches from here.
  await store
    .updateArtifactContent(userId, artifactId, withRevisionMarker(art.content as Record<string, unknown>, rev.id, { formatted: artifactText(art.content), kind: "edit" }), art.content)
    .catch(() => "failed");
  return { ok: true, revision: currentRevisionStatus(rev), reused: saved.revision.reused };
}
