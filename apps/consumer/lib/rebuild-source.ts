/**
 * The writer's source for a rebuild (Phase 6 lane S1, round 2; CC's truth
 * ruling 2026-10-11). Server only.
 *
 * "Build it with t.ROY" and "Rewrite it with t.ROY" start a new build from a
 * saved resume. The page may be AI-written (a Tailor result, an older
 * finished version), so the page itself is never the person's own words.
 * What counts as theirs is decided HERE, where the revision is read as the
 * person (owner only), from stored data the server wrote. Nothing in a
 * request (an origin, a flag, the page text) changes it.
 *
 *   "given":     the newest version is a page the person saved exactly as
 *                they gave it (the lanes-first first save: their upload or
 *                their "Build with me" section). The server marked it when
 *                it saved it (evidence.givenAsIs) and the stored text still
 *                matches the mark. Its text is their own words.
 *   "own_words": the version carries the person's own words as the server
 *                worked them out when it was saved (evidence.ownResumeText).
 *                Those are the writer's source and the gate's own words; the
 *                page is only shown.
 *   "page_only": neither. The page is the writer's starting point, but
 *                nothing on it counts as theirs. The own resume text is the
 *                account's stored upload when there is one (server-held, the
 *                person's own words, as check mode's recheck uses; round 2b),
 *                else empty. Its grounding says so (startingPageOnly, signed
 *                into the writer's receipt), and lines are confirmed the
 *                stricter way (no rewording A).
 */

import type { RevisionStore } from "./revision-save";
import { givenTextMark, inputFromRevision } from "./revision-status";

export type RebuildOrigin = "given" | "own_words" | "page_only";

export interface RebuildSource {
  artifactId: string;
  /** The saved page, as it reads now. Shown to the person; the writer's material only for "page_only". */
  pageText: string;
  /** What counts as the person's own resume text for this build (never the page; for "page_only" the stored upload or ""). */
  ownResumeText: string;
  origin: RebuildOrigin;
}

/** Read the newest saved version AS the person and decide its own words. Null: not theirs, not a resume, or nothing saved. */
export async function loadRebuildSource(
  userId: string,
  artifactId: string,
  store: Pick<RevisionStore, "getArtifact" | "getLatestRevision" | "serverSource">
): Promise<RebuildSource | null> {
  if (!userId || !artifactId) return null;
  const art = await store.getArtifact(userId, artifactId);
  if (!art || art.artifact_type !== "resume") return null;
  const rev = await store.getLatestRevision(userId, artifactId);
  if (!rev || typeof rev.resume_text !== "string" || !rev.resume_text.trim()) return null;
  const input = inputFromRevision(rev);
  const ev = input?.evidence;
  const pageText = rev.resume_text;
  if (rev.source === "forge_finish" && ev?.givenAsIs && ev.givenAsIs === givenTextMark(pageText)) {
    return { artifactId, pageText, ownResumeText: pageText, origin: "given" };
  }
  const own = (ev?.ownResumeText ?? "").trim() ? (ev as { ownResumeText: string }).ownResumeText : "";
  if (own) return { artifactId, pageText, ownResumeText: own, origin: "own_words" };
  // Round 2b: the account's stored upload (never the page), when the server holds one.
  const held = store.serverSource ? await store.serverSource(userId, false).catch(() => null) : null;
  return { artifactId, pageText, ownResumeText: held?.ownResumeText ?? "", origin: "page_only" };
}

/**
 * The writer's inputs for a rebuild. `writer`: what the writer reads (its
 * material). `source`: what the receipt, the second check and the gate count
 * as the person's own words: the request with its resume text replaced by the
 * server's own resume text. The request's own resume text is never used.
 */
export function rebuildInputs<T extends { resumeText?: string }>(input: T, rb: RebuildSource): { writer: T; source: T; startingPageOnly: boolean } {
  const startingPageOnly = rb.origin === "page_only";
  return {
    writer: { ...input, resumeText: startingPageOnly ? rb.pageText : rb.ownResumeText },
    source: { ...input, resumeText: rb.ownResumeText },
    startingPageOnly,
  };
}

/** The rebuild store: the revision store's reads, every one AS the person. */
export async function rebuildStore(): Promise<Pick<RevisionStore, "getArtifact" | "getLatestRevision" | "serverSource">> {
  const { coreStore } = await import("./revision-save");
  return coreStore();
}
