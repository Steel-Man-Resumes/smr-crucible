/**
 * The person's own evidence set for "Check and finish" (fix lane check,
 * 2026-10-24, Valjean walk defects 3 and 6). Pure; the store reads the rows.
 *
 * What the person already gave, and nothing else:
 *   - Master Draft details they confirmed (status "confirmed"; an unchecked
 *     detail is not evidence),
 *   - every line of a resume they FINISHED: the newest finished revision of
 *     each of their other resumes (the gate passed it, so every line on it was
 *     defended or was their own words),
 *   - their typed Forge answers, which already arrive through serverSource
 *     (upload, goal box, licenses answer).
 * Never Forge AI analysis (skills and strengths the model wrote), never a
 * draft, never the resume being checked, and never a line about the record.
 *
 * A claim supported by this set is never asked about as "not in anything you
 * told us": the check reads it as the person's own words.
 */

import { masterWorkFacts } from "./master-draft";
import { isJusticeSensitive } from "./grounding-verify";
import type { WriterSource } from "./writer-receipt";

/** A revision row, only the fields this reads. */
export interface EvidenceRevision {
  artifact_id: string;
  status: string;
  resume_text: string;
  created_at: string;
  revision_number: number;
}

/** Most text the set may add, so a verifier prompt stays inside its source window. */
export const PERSON_EVIDENCE_MAX = 24000;

const lineKey = (l: string) => l.toLowerCase().replace(/^\s*[-•*]\s*/, "").replace(/[^a-z0-9%]+/g, " ").trim();

/**
 * The evidence lines, in order: confirmed Master Draft details first, then
 * the lines of each finished resume (newest first), one copy of each line.
 * `excludeArtifactId` is the resume being checked: its own draft is never its
 * own evidence.
 */
export function personEvidenceLines(masterDraft: unknown, revisions: ReadonlyArray<EvidenceRevision>, excludeArtifactId?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const l = raw.replace(/\s+/g, " ").trim();
    const k = lineKey(l);
    if (!k || seen.has(k) || isJusticeSensitive(l)) return;
    seen.add(k);
    out.push(l);
  };
  for (const fact of masterWorkFacts(masterDraft)) add(fact);
  const newestFinished = new Map<string, EvidenceRevision>();
  for (const r of revisions) {
    if (!r || r.status !== "finished" || typeof r.resume_text !== "string" || !r.resume_text.trim()) continue;
    if (excludeArtifactId && r.artifact_id === excludeArtifactId) continue;
    const prev = newestFinished.get(r.artifact_id);
    if (!prev || r.created_at > prev.created_at || (r.created_at === prev.created_at && r.revision_number > prev.revision_number)) newestFinished.set(r.artifact_id, r);
  }
  const finished = Array.from(newestFinished.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  for (const r of finished) for (const l of r.resume_text.split("\n")) add(l);
  let size = 0;
  return out.filter((l) => (size += l.length + 1) <= PERSON_EVIDENCE_MAX);
}

/**
 * The server-held source with the evidence lines added to the person's own
 * words. Lines already in their words are not repeated. Kept as its own
 * paragraph, so it never runs into the goal box.
 */
export function withPersonEvidence(source: WriterSource, lines: ReadonlyArray<string>): WriterSource {
  const have = new Set(`${source.ownWords}\n${source.ownResumeText}`.split("\n").map(lineKey).filter(Boolean));
  const extra = lines.filter((l) => !have.has(lineKey(l)));
  if (!extra.length) return source;
  return { ...source, ownWords: [source.ownWords.trim(), extra.join("\n")].filter(Boolean).join("\n\n") };
}
