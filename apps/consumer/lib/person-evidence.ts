/**
 * What the person already gave, for "Check and finish" (fix lane check,
 * 2026-10-24; fix round 1 after review). Pure; the store reads the rows.
 *
 * Two kinds, kept apart (boss ruling on review S1, DEC-46):
 *   - facts: Master Draft details the person CONFIRMED. With the answers and
 *     rewrites they typed on the page, these are the only things beside their
 *     own uploaded words that clear a flag.
 *   - finished: the lines of their other resumes whose NEWEST version is
 *     finished (review S2), one block per resume (review B2). "Checked once":
 *     they never clear a flag by themselves. A card on a line they already
 *     finished says so ("You finished this line on ...; confirm it stands
 *     here") with the same answer path.
 * Also `unconfirmed`: details not confirmed yet, used only to point a card at
 * the detail that would settle it (review Q6). Never evidence.
 *
 * Never Forge AI analysis, never the resume being checked, never a record
 * line: a job block whose header is about the record goes whole, header and
 * every line under it, so an inside duty can never sit under an outside job.
 *
 * Rebuilt fresh on every check, load and check save (review B5). Stored in
 * its own evidence fields, never in ownWords, never carried by an edit or a
 * fork (lib/revision-status.ts editInput).
 */

import { readMasterDraft } from "./master-draft";
import { isJusticeSensitive } from "./grounding-verify";
import { jobsIn } from "@crucible/core/src/jobResolver";
import { isSectionHeader } from "@crucible/core/src/pageFitShared";
import type { FinishedBlock, PersonEvidence } from "./person-evidence-shape";
export type { FinishedBlock, PersonEvidence } from "./person-evidence-shape";
export { NO_PERSON_EVIDENCE, readPersonEvidence } from "./person-evidence-shape";

/** A revision row, only the fields this reads. */
export interface EvidenceRevision {
  artifact_id: string;
  status: string;
  resume_text: string;
  created_at: string;
  revision_number: number;
}


/**
 * The most detail text kept. The model verifier reads at most VERIFY_MAX
 * (lib/limits.ts) of its whole source, the upload first, so details past that
 * window reach only the deterministic gate, never the model (that errs
 * strict). The cap bounds the stored evidence and the page payload.
 */
export const PERSON_EVIDENCE_MAX = 24000;
const FINISHED_MAX_LINES = 400;

const clip = (lines: string[], max: number) => {
  let size = 0;
  return lines.filter((l) => (size += l.length + 1) <= max);
};

/** A finished resume's lines without any job block about the record (review B2) or any record line. */
export function finishedLinesOf(text: string): string[] {
  const lines = (text || "").split("\n").map((l) => l.trim());
  const drop = new Set<number>();
  // A job block runs from its header to the next job header or section header.
  const jobs = jobsIn(text);
  for (const j of jobs) {
    if (!isJusticeSensitive([...j.lines, j.employer, j.title, j.place].join(" "))) continue;
    const start = lines.findIndex((l, i) => !drop.has(i) && l === j.lines[0]);
    if (start < 0) continue;
    drop.add(start);
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (isSectionHeader(l) || jobs.some((o) => o !== j && o.lines[0] === l)) break;
      drop.add(i);
    }
  }
  return lines.filter((l, i) => l && !drop.has(i) && !isJusticeSensitive(l));
}

/** The name a card uses for a resume ("your Forge resume", "your resume for Production Supervisor"). */
export function resumeNameOf(targetContext: unknown): string {
  const tc = (targetContext ?? {}) as { source?: unknown; targetJob?: unknown };
  const job = typeof tc.targetJob === "string" ? tc.targetJob.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (job) return `your resume for ${job}`;
  return tc.source === "forge" ? "your Forge resume" : "another resume of yours";
}

/**
 * The person's evidence from their own rows. `excludeArtifactId` is the
 * resume being checked: never its own evidence.
 */
export function personEvidenceFrom(
  masterDraft: unknown,
  revisions: ReadonlyArray<EvidenceRevision>,
  artifacts: ReadonlyArray<{ id: string; target_context?: unknown }>,
  excludeArtifactId?: string
): PersonEvidence {
  const md = readMasterDraft(masterDraft);
  const keep = (status: "confirmed" | "needs_check") =>
    clip(md.facts.filter((f) => f.status === status && !isJusticeSensitive(f.text)).map((f) => f.text.replace(/\s+/g, " ").trim()), PERSON_EVIDENCE_MAX);
  // Newest revision per resume; its lines count only when that newest one is finished (review S2).
  const newest = new Map<string, EvidenceRevision>();
  for (const r of revisions) {
    if (!r || typeof r.artifact_id !== "string" || (excludeArtifactId && r.artifact_id === excludeArtifactId)) continue;
    const prev = newest.get(r.artifact_id);
    if (!prev || r.created_at > prev.created_at || (r.created_at === prev.created_at && r.revision_number > prev.revision_number)) newest.set(r.artifact_id, r);
  }
  const names = new Map(artifacts.map((a) => [a.id, resumeNameOf(a.target_context)]));
  const finished = Array.from(newest.values())
    .filter((r) => r.status === "finished" && typeof r.resume_text === "string" && r.resume_text.trim())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((r) => ({ name: names.get(r.artifact_id) ?? "another resume of yours", lines: clip(finishedLinesOf(r.resume_text), PERSON_EVIDENCE_MAX).slice(0, FINISHED_MAX_LINES) }))
    .filter((b) => b.lines.length);
  return { facts: keep("confirmed"), unconfirmed: keep("needs_check"), finished };
}
