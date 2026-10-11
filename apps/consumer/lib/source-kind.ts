/**
 * Where a build's page came from, and whether rewording A may apply to it
 * (Phase 6 lane S1 round 3, CC's ruling on review r1 H2 and H1). Server only.
 *
 * Rewording A (a reworded line whose facts trace back raises no card) is
 * OPT-IN. A grounding gets the positive marker `rewordingA: true` only from a
 * server signer that worked out the source kind itself, from server-held
 * data, for the run or revision it is signing:
 *   "given":     the page is what the person gave (a Forge run's own resume
 *                text, or a first save the server marked as given);
 *   "own_words": the version carries own words the server stored for it,
 *                from a build it signed as eligible;
 *   "page_only": a page that is not the person's own words (a Tailor result,
 *                anything AI-written without stored own words);
 *   "unknown":   the server cannot tell.
 * Only "given" and "own_words" are eligible. Every signer (generate-docs,
 * signed-in Check it again, Check it as it is) stamps the grounding through
 * withRewording, which always overwrites both fields, so a marker is never
 * carried in from a request or defaulted on. A grounding without the marker
 * gets the stricter rule (finish-gate factsLockedFor).
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { givenTextMark, inputFromRevision, type RevisionEvidence } from "./revision-status";
import { readReceipt } from "./writer-receipt";

export type SourceKind = "given" | "own_words" | "page_only" | "unknown";

/** The one rule: may rewording A apply to a build from this kind of source? */
export function rewordingAFor(kind: SourceKind): boolean {
  return kind === "given" || kind === "own_words";
}

/** The grounding a server signer is about to sign, stamped with the kind it worked out. Never keeps a marker it was handed. */
export function withRewording<T extends Record<string, unknown>>(grounding: T, kind: SourceKind): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rewordingA: _a, sourceKind: _k, startingPageOnly: _s, ...rest } = grounding as Record<string, unknown>;
  return { ...rest, sourceKind: kind, ...(rewordingAFor(kind) ? { rewordingA: true } : {}) };
}

const evOf = (rev: Pick<ArtifactRevision, "evidence">) => (rev.evidence ?? {}) as Partial<RevisionEvidence>;

/**
 * Review r1 H1: a version the WRITER made. Its receipt matched when the
 * server saved it, and that receipt came from generate-docs: not an
 * artifact check ("artifact:" run) and not a signed-out check.
 */
export function writtenByWriter(rev: Pick<ArtifactRevision, "evidence">): boolean {
  const ev = evOf(rev);
  if (ev.writerVerified !== true || !ev.written) return false;
  const meta = readReceipt(ev.writerReceipt);
  if (!meta || meta.k === "check" || !meta.run || meta.run.startsWith("artifact:")) return false;
  return typeof ev.runId !== "string" || !ev.runId.startsWith("artifact:");
}

/** Any version in this resume's lineage was made by the writer. */
export function fromWriterLineage(revs: ReadonlyArray<Pick<ArtifactRevision, "evidence">>): boolean {
  return revs.some(writtenByWriter);
}

/** A first save the server marked as given, with exactly this text, somewhere in the lineage. */
export function givenInLineage(revs: ReadonlyArray<Pick<ArtifactRevision, "source" | "evidence">>, text: string): boolean {
  const mark = givenTextMark(text);
  return revs.some((r) => r.source === "forge_finish" && evOf(r).givenAsIs === mark);
}

/**
 * The kind of a stored version's page. `lineage`: every version of that
 * resume (for the given mark; a check of the same text keeps it given).
 */
export function revisionKind(rev: ArtifactRevision, lineage: ReadonlyArray<ArtifactRevision> = [rev], text: string = rev.resume_text): SourceKind {
  // Given only for exactly the page that was marked (a Tailor change of it is not).
  if (givenInLineage([...lineage, rev], text)) return "given";
  const ev = inputFromRevision(rev)?.evidence;
  if (!ev || ev.writerVerified !== true || !ev.ownResumeText.trim()) return "page_only";
  const g = (ev.grounding ?? null) as { sourceKind?: unknown; startingPageOnly?: unknown } | null;
  // What the signer recorded for that build; older builds marked only a page-only start.
  if (g && (g.sourceKind === "page_only" || g.sourceKind === "unknown" || g.startingPageOnly === true)) return "page_only";
  return "own_words";
}
