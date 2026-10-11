/**
 * The writer's source for a rebuild (Phase 6 lane S1, round 2; CC's truth
 * ruling 2026-10-11). Server only.
 *
 * "Build it with t.ROY" and "Rewrite it with t.ROY" start a new build from a
 * saved resume. The page may be AI-written (a Tailor result, an older
 * finished version), so the page itself is never the person's own words.
 * What counts as their own RESUME TEXT is decided HERE, where the revision is
 * read as the person (owner only), from stored data the server wrote. No
 * origin, flag or page text in a request changes it. (The person's typed
 * answers sent with the build, their goal, their "what would make work
 * yours" answer and their licenses answer and rows, still come from the
 * request, the same paste-trust model as every Forge run.)
 *
 * The writer always starts from the page (review r1 M5). The kind
 * (lib/source-kind.ts revisionKind) decides the own words:
 *   "given":     the page is one the person saved exactly as they gave it
 *                (a first save the server marked; a check of the same text
 *                keeps it). Its text is their own words.
 *   "own_words": the version carries own words the server stored for it, from
 *                a build it signed as eligible. Those are the own words; page
 *                lines that are not in them are asked.
 *   "page_only": neither. Nothing on the page counts. The own words are the
 *                account's stored upload when there is one (round 2b), else
 *                none. Not eligible for rewording A: the stricter rule.
 */

import type { RevisionStore } from "./revision-save";
import { inputFromRevision } from "./revision-status";
import { artifactText } from "./revision-current";
import { revisionKind } from "./source-kind";

export type RebuildOrigin = "given" | "own_words" | "page_only";

export interface RebuildSource {
  artifactId: string;
  /** The saved page, as it reads now. Shown to the person, and the writer's starting text (review r1 M5). */
  pageText: string;
  /**
   * What counts as the person's own resume text for this build: never the
   * page, unless the page is what they gave. For "page_only", the account's
   * stored upload (held-back record lines included; the build applies the
   * person's keep choice), or "".
   */
  ownResumeText: string;
  origin: RebuildOrigin;
}

export type RebuildStore = Pick<RevisionStore, "getArtifact" | "getLatestRevision" | "serverSource" | "listRevisions">;

/** Read the newest saved version AS the person and decide its own words. Null: not theirs, not a resume, or no text. */
export async function loadRebuildSource(userId: string, artifactId: string, store: RebuildStore): Promise<RebuildSource | null> {
  if (!userId || !artifactId) return null;
  const art = await store.getArtifact(userId, artifactId);
  if (!art || art.artifact_type !== "resume") return null;
  const rev = await store.getLatestRevision(userId, artifactId);
  // An older save with no version yet: its stored text, and nothing on it is theirs.
  const pageText = rev && typeof rev.resume_text === "string" && rev.resume_text.trim() ? rev.resume_text : artifactText(art.content);
  if (!pageText.trim()) return null;
  const held = async () => (store.serverSource ? ((await store.serverSource(userId, true).catch(() => null))?.ownResumeText ?? "") : "");
  if (!rev || rev.resume_text !== pageText) return { artifactId, pageText, ownResumeText: await held(), origin: "page_only" };
  const lineage = store.listRevisions ? await store.listRevisions(userId, artifactId).catch(() => [rev]) : [rev];
  const kind = revisionKind(rev, lineage);
  if (kind === "given") return { artifactId, pageText, ownResumeText: pageText, origin: "given" };
  if (kind === "own_words") return { artifactId, pageText, ownResumeText: inputFromRevision(rev)?.evidence.ownResumeText ?? "", origin: "own_words" };
  // Round 2b: the account's stored upload (never the page), when the server holds one.
  return { artifactId, pageText, ownResumeText: await held(), origin: "page_only" };
}

/**
 * The writer's inputs for a rebuild. `writer`: what the writer reads, the
 * page itself (review r1 M5: "Rewrite it with t.ROY" rebuilds FROM THIS
 * PAGE, so tailoring and the person's edits carry over). `source`: what the
 * receipt, the second check and the gate count as the person's own words,
 * the request with its resume text replaced by the server's own resume text.
 * The request's own resume text is never used.
 */
export function rebuildInputs<T extends { resumeText?: string }>(input: T, rb: RebuildSource): { writer: T; source: T } {
  return {
    writer: { ...input, resumeText: rb.pageText },
    source: { ...input, resumeText: rb.ownResumeText },
  };
}

/** The rebuild store: the revision store's reads, every one AS the person. */
export async function rebuildStore(): Promise<RebuildStore> {
  const { coreStore } = await import("./revision-save");
  return coreStore();
}
