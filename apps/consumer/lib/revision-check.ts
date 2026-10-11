/**
 * "Check and finish" for a resume that was never finished in the Forge
 * (Phase 5 lane R2, CC 2026-10-10): a Refinery resume, a Tailor result, an
 * older saved resume. Server only.
 *
 * Under R1's rule raw text is always DRAFT. This is the way out, built on
 * R1's ONE re-check path (lib/forge-recheck.ts, recheckDocs kind "artifact",
 * POST /api/forge/recheck):
 *   1. The finish page asks R1 to check the stored resume for real: R1 reads
 *      it on the server, runs the second check against the person's own
 *      words as the server holds them, signs a receipt bound to the account
 *      and the run "artifact:<id>", and saves that checked version. A second
 *      check that BLOCKs a line keeps it a draft, with that line as a card.
 *   2. loadCheckSource (read only) hands the page that checked version: its
 *      text, the person's words, the second check and the answers.
 *   3. The person answers the same cards. saveCheckRevision saves their
 *      answers on top of the checked version: everything the gate trusts
 *      (the checked documents, the second check, the receipt, the person's
 *      own words) is carried over from that stored version by R1's editInput.
 *      Only the page text and the person's own card answers, kept terms and
 *      confirmations come from the request. Written documents, grounding or
 *      a receipt in a request are never used. The gate decides the status.
 *
 * This file signs nothing. Nothing in R1's own save, export or email code
 * changes.
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { cleanRevisionInput, computeRevision, editInput, inputFromRevision, revisionRecord, type RevisionEvidence } from "./revision-status";
import { resumeTextToDocument } from "./revision-to-doc";
import { withRevisionMarker } from "./revision-marker";
import { artifactText, textFromBase } from "./revision-current";
import { artifactRunId } from "./forge-recheck";
import type { ArtifactLite, RevisionStore, SavedRevisionSummary } from "./revision-save";
import type { RunEvidence } from "./finish-payload";

const isForge = (a: { artifact_type: string; target_context: unknown }) =>
  a.artifact_type === "resume" && (a.target_context as { source?: unknown } | null)?.source === "forge";

/** A locked baseline never changes in place, so Check and finish refuses it (review L4). */
export const LOCKED_REASON = "locked";
/** The stored resume has no current check from R1's re-check path: the page asks for one first. */
export const NEEDS_CHECK_REASON = "needs_check";

/** True when this version was checked by R1's re-check for exactly this resume (a receipt the server verified). */
export function checkedFor(rev: Pick<ArtifactRevision, "evidence"> | null | undefined, artifactId: string): boolean {
  const ev = (rev?.evidence ?? {}) as Partial<RevisionEvidence>;
  return ev.writerVerified === true && ev.runId === artifactRunId(artifactId);
}

/** The newest version, when it is R1's check of this resume and the stored content still reads as it. */
async function currentChecked(userId: string, art: ArtifactLite, store: RevisionStore): Promise<ArtifactRevision | null> {
  const newest = await store.getLatestRevision(userId, art.id);
  if (!newest || !checkedFor(newest, art.id)) return null;
  // Edited in the Refinery since that check: it needs checking again.
  const now = artifactText(art.content) ? textFromBase(art.content, newest) : "";
  return now && now.trim() === newest.resume_text.trim() ? newest : null;
}

export interface CheckSource {
  artifactId: string;
  title: string;
  resumeText: string;
  letterText: string;
  status: "draft" | "finished";
  evidence: RunEvidence;
  /** The checked documents and the second check, as R1 stored them (the page shows the same cards). */
  written: { resume: string; letter: string } | null;
  grounding: unknown;
  defendAnswers: unknown[];
  keptTerms: string[];
  confirmedCredentials: unknown[];
  lengthChoice: string;
}

export type CheckLoad = { ok: true; source: CheckSource } | { ok: false; status: number; reason: string };

/**
 * Load a resume for "Check and finish". READ ONLY (review L2). Answers 409
 * needs_check when the stored resume has no current check yet; the page then
 * calls R1's POST /api/forge/recheck (which checks and saves) and loads again.
 */
export async function loadCheckSource(userId: string, artifactId: string, store: RevisionStore): Promise<CheckLoad> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art) return { ok: false, status: 404, reason: "artifact not found" };
  if (art.artifact_type !== "resume") return { ok: false, status: 409, reason: "not a resume" };
  if (art.is_locked) return { ok: false, status: 409, reason: LOCKED_REASON };
  const rev = await currentChecked(userId, art, store);
  if (!rev) return { ok: false, status: 409, reason: NEEDS_CHECK_REASON };
  const ev = (rev.evidence ?? {}) as Partial<RevisionEvidence>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const tc = (art.target_context ?? {}) as { targetJob?: unknown };
  const w = ev.written as { resume?: unknown; letter?: unknown } | null | undefined;
  return {
    ok: true,
    source: {
      artifactId,
      title: typeof tc.targetJob === "string" && tc.targetJob.trim() ? tc.targetJob.trim() : isForge(art) ? "Your Forge resume" : "Your resume",
      resumeText: rev.resume_text,
      letterText: rev.letter_text ?? "",
      status: rev.status,
      evidence: {
        ownWords: str(ev.ownWords),
        credentialsAnswer: str(ev.credentialsAnswer),
        credentialRows: Array.isArray(ev.credentialRows) ? ev.credentialRows : [],
        ownResumeText: str(ev.ownResumeText),
      },
      written: w && typeof w.resume === "string" && typeof w.letter === "string" ? { resume: w.resume, letter: w.letter } : null,
      grounding: ev.grounding ?? null,
      defendAnswers: Array.isArray(rev.defend_answers) ? rev.defend_answers : [],
      keptTerms: Array.isArray(rev.kept_terms) ? (rev.kept_terms.filter((t) => typeof t === "string") as string[]) : [],
      confirmedCredentials: Array.isArray(rev.confirmed_credentials) ? rev.confirmed_credentials : [],
      lengthChoice: rev.length_choice,
    },
  };
}

export type CheckSaveResult = { ok: true; revision: SavedRevisionSummary } | { ok: false; status: number; reason: string };

/**
 * Save the person's answers on top of R1's checked version of this resume.
 * Everything the gate trusts is carried from that stored version (editInput,
 * trusted); the request supplies only the page text and the person's own
 * answers, kept terms, confirmations and length choice.
 */
export async function saveCheckRevision(userId: string, artifactId: string, raw: unknown, store: RevisionStore): Promise<CheckSaveResult> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art) return { ok: false, status: 404, reason: "artifact not found" };
  if (art.artifact_type !== "resume") return { ok: false, status: 409, reason: "not a resume" };
  // A locked baseline keeps its content, so a finished version saved here would
  // differ from what its exports print (review L4): refused, never half-saved.
  if (art.is_locked) return { ok: false, status: 409, reason: LOCKED_REASON };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, reason: "no finish state" };
  const checked = await currentChecked(userId, art, store);
  const base = checked ? inputFromRevision(checked) : null;
  if (!checked || !base) return { ok: false, status: 409, reason: NEEDS_CHECK_REASON };

  // The page's part, cleaned as an untrusted finish state: only its text and
  // the person's own answers are read from it below.
  const page = cleanRevisionInput(raw);
  if (!page.ok) return { ok: false, status: page.reason === "too long" ? 413 : 400, reason: page.reason };
  // Everything else from the stored, checked version (R1's carry-over).
  const edited = editInput(base, page.input.resumeText, page.input.letterText);
  if (!edited.ok) return { ok: false, status: edited.reason === "too long" ? 413 : 400, reason: edited.reason };
  const input = {
    ...edited.input,
    lengthChoice: page.input.lengthChoice,
    defendAnswers: page.input.defendAnswers,
    keptTerms: page.input.keptTerms,
    confirmedCredentials: page.input.confirmedCredentials,
  };
  const verdict = computeRevision(input);
  const r = await store.insertRevision(userId, revisionRecord(artifactId, "forge_finish", input, verdict));
  if (r.status === "not_ready") return { ok: false, status: 503, reason: "not_ready" };
  if (r.status !== "saved") return { ok: false, status: r.status === "invalid" ? 400 : 500, reason: r.status === "invalid" ? r.reason : "failed" };
  if (!r.reused) {
    // The resume in the Refinery now shows the checked words, marked as
    // exactly this revision, so its downloads use it (R1's marker).
    const baseDoc = (art.content ?? null) as { meta?: { targetJob?: string; targetCompany?: string; jobListingUrl?: string } } | null;
    const doc = resumeTextToDocument(input.resumeText, baseDoc) as unknown as Record<string, unknown>;
    const wrote = await store
      .updateArtifactContent(userId, artifactId, withRevisionMarker(doc, r.revision.id, { formatted: artifactText(doc), kind: "finish" }))
      .catch(() => "failed");
    // Locked between the check above and now: say so, never claim the exports match.
    if (wrote === "locked") return { ok: false, status: 409, reason: LOCKED_REASON };
  }
  const rev = r.revision;
  return {
    ok: true,
    revision: {
      id: rev.id,
      artifactId: rev.artifact_id,
      number: rev.revision_number,
      status: rev.status,
      pageCount: rev.page_count,
      pageLimit: rev.page_limit,
      lengthChoice: rev.length_choice,
      openItems: Array.isArray(rev.open_items) ? rev.open_items : [],
      lengthItem: verdict.lengthItem ?? null,
      contentHash: rev.content_hash,
      reused: r.reused,
      createdAt: rev.created_at,
    },
  };
}
