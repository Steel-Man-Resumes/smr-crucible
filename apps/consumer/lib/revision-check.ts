/**
 * "Check and finish" for a resume that was never finished in the Forge
 * (Phase 5 lane R2, CC 2026-10-10): a Refinery resume, a Tailor result, an
 * older saved resume. Server only.
 *
 * Under R1's rule raw text is always DRAFT. This is the way out: the finish
 * page opens with THAT resume loaded, runs the same cards, and saves a
 * revision on that same artifact through R1's pieces (cleanRevisionInput,
 * computeRevision, revisionRecord, insertRevision). Nothing in R1's own save,
 * export or email code changes.
 *
 * NO INVENTED EVIDENCE. The person's own words are never taken from the
 * request: the server supplies them, from the person's own Forge revision
 * (what they gave the Forge: their resume as they wrote it, their answers),
 * and overwrites whatever the request carried. The resume being checked, a
 * job posting or a writer's draft never count as the person's words. A line
 * without the person's words gets the normal cards. Only the person's own
 * card answers (true as written, a change, a cut, a confirmation) come from
 * the page, exactly as on the Forge finish page.
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { cleanRevisionInput, computeRevision, inputFromRevision, revisionRecord } from "./revision-status";
import { resumeTextToDocument } from "./revision-to-doc";
import { withRevisionMarker } from "./revision-marker";
import { artifactText, baseRevisionFor, revisionIsCurrent, textFromBase } from "./revision-current";
import { pickForgeArtifact, type ArtifactLite, type RevisionStore, type SavedRevisionSummary } from "./revision-save";
import { writerReceipt } from "./writer-receipt";
import type { RunEvidence } from "./finish-payload";

const isForge = (a: { artifact_type: string; target_context: unknown }) =>
  a.artifact_type === "resume" && (a.target_context as { source?: unknown } | null)?.source === "forge";

export const NO_EVIDENCE: RunEvidence = { ownWords: "", credentialsAnswer: "", credentialRows: [], ownResumeText: "" };

/**
 * The person's own words, from their own Forge resume's saved versions.
 * Empty when they have none. With a store that can list versions, every
 * version's words count (newest first, each once): since review H2 a first
 * save holds only what was typed on that screen, so the newest version alone
 * can be thinner than what the person has already given.
 */
export async function ownEvidence(userId: string, store: RevisionStore & { listRevisions?: (userId: string, artifactId: string) => Promise<ArtifactRevision[]> }): Promise<RunEvidence> {
  const forge = pickForgeArtifact(await store.listResumeArtifacts(userId));
  if (!forge) return NO_EVIDENCE;
  const revs = store.listRevisions
    ? (await store.listRevisions(userId, forge.id)).sort((a, b) => b.revision_number - a.revision_number).slice(0, 20)
    : [await store.getLatestRevision(userId, forge.id)].filter((r): r is ArtifactRevision => !!r);
  const evs = revs.map((r) => inputFromRevision(r)?.evidence).filter((e): e is NonNullable<typeof e> => !!e);
  if (!evs.length) return NO_EVIDENCE;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const words: string[] = [];
  for (const e of evs) {
    const w = str(e.ownWords).trim();
    if (w && !words.includes(w)) words.push(w);
  }
  return {
    ownWords: words.join("\n\n"),
    credentialsAnswer: evs.map((e) => str(e.credentialsAnswer)).find((x) => x.trim()) ?? "",
    credentialRows: evs.map((e) => (Array.isArray(e.credentialRows) ? e.credentialRows : [])).find((x) => x.length) ?? [],
    ownResumeText: evs.map((e) => str(e.ownResumeText)).find((x) => x.trim()) ?? "",
  };
}

export interface CheckSource {
  artifactId: string;
  title: string;
  resumeText: string;
  letterText: string;
  status: "draft" | "finished";
  evidence: RunEvidence;
  /** The person's own earlier answers on THIS artifact (its newest revision), never another's. */
  defendAnswers: unknown[];
  keptTerms: string[];
  confirmedCredentials: unknown[];
  lengthChoice: string;
}

export type CheckLoad = { ok: true; source: CheckSource } | { ok: false; status: number; reason: string };

/** A locked baseline never changes in place, so Check and finish refuses it (review L4). */
export const LOCKED_REASON = "locked";

/**
 * Load a resume for "Check and finish": its current text and the person's own
 * words. READ ONLY (review L2): nothing is written on this read. When the
 * stored content is exactly its newest revision, that revision; otherwise the
 * stored text read the way R1's export reads it (lib/revision-current.ts),
 * as a draft, with the answers R1 would carry over from its base revision.
 */
type SourceRev = Pick<ArtifactRevision, "resume_text" | "letter_text" | "status" | "defend_answers" | "kept_terms" | "confirmed_credentials" | "length_choice">;

/** The text a resume stands for right now, read only (the same reading as R1's export). */
async function currentSource(
  userId: string,
  art: ArtifactLite,
  store: RevisionStore
): Promise<{ ok: true; rev: SourceRev; newest: ArtifactRevision | null } | { ok: false; status: number; reason: string }> {
  const newest = await store.getLatestRevision(userId, art.id);
  let rev: SourceRev;
  if (newest && revisionIsCurrent(art.content, newest)) {
    rev = newest;
  } else {
    const base = newest ?? (await baseRevisionFor(userId, art, store));
    const text = base ? textFromBase(art.content, base) : artifactText(art.content);
    if (!text.trim()) return { ok: false, status: 409, reason: "no resume text" };
    rev = {
      resume_text: text,
      letter_text: base?.letter_text ?? "",
      status: "draft",
      defend_answers: base?.defend_answers ?? [],
      kept_terms: base?.kept_terms ?? [],
      confirmed_credentials: base?.confirmed_credentials ?? [],
      length_choice: base?.length_choice ?? "auto",
    };
  }
  return { ok: true, rev, newest };
}

/**
 * "What the system delivered" for this resume, before the person's answers:
 * the stored resume as Check and finish first opened it. The SERVER read it
 * from storage, so the server signs it (R1's writer receipt, review M1) and the
 * request never supplies it. It carries forward from the first check save, so
 * the person's own changes never become "the system's" lines.
 */
function deliveredFor(src: { rev: SourceRev; newest: ArtifactRevision | null }): { resume: string; letter: string } {
  const ev = (src.newest?.evidence ?? {}) as { written?: { resume?: unknown; letter?: unknown } | null; writerVerified?: unknown };
  if (ev.writerVerified === true && ev.written && typeof ev.written.resume === "string" && typeof ev.written.letter === "string") {
    return { resume: ev.written.resume, letter: ev.written.letter };
  }
  return { resume: src.rev.resume_text, letter: src.rev.letter_text ?? "" };
}

export async function loadCheckSource(userId: string, artifactId: string, store: RevisionStore): Promise<CheckLoad> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art) return { ok: false, status: 404, reason: "artifact not found" };
  if (art.artifact_type !== "resume") return { ok: false, status: 409, reason: "not a resume" };
  if (art.is_locked) return { ok: false, status: 409, reason: LOCKED_REASON };
  const src = await currentSource(userId, art, store);
  if (!src.ok) return src;
  const rev = src.rev;
  const evidence = await ownEvidence(userId, store);
  const tc = (art.target_context ?? {}) as { targetJob?: unknown };
  return {
    ok: true,
    source: {
      artifactId,
      title: typeof tc.targetJob === "string" && tc.targetJob.trim() ? tc.targetJob.trim() : isForge(art) ? "Your Forge resume" : "Your resume",
      resumeText: rev.resume_text,
      letterText: rev.letter_text ?? "",
      status: rev.status,
      evidence,
      defendAnswers: Array.isArray(rev.defend_answers) ? rev.defend_answers : [],
      keptTerms: Array.isArray(rev.kept_terms) ? (rev.kept_terms.filter((t) => typeof t === "string") as string[]) : [],
      confirmedCredentials: Array.isArray(rev.confirmed_credentials) ? rev.confirmed_credentials : [],
      lengthChoice: rev.length_choice,
    },
  };
}

export type CheckSaveResult = { ok: true; revision: SavedRevisionSummary } | { ok: false; status: number; reason: string };

/** Save the finish page's state for this artifact, with the server's own evidence in place of the request's. */
export async function saveCheckRevision(userId: string, artifactId: string, raw: unknown, store: RevisionStore): Promise<CheckSaveResult> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art) return { ok: false, status: 404, reason: "artifact not found" };
  if (art.artifact_type !== "resume") return { ok: false, status: 409, reason: "not a resume" };
  // A locked baseline keeps its content, so a finished version saved here would
  // differ from what its exports print (review L4): refused, never half-saved.
  if (art.is_locked) return { ok: false, status: 409, reason: LOCKED_REASON };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, reason: "no finish state" };
  const ev = await ownEvidence(userId, store);
  const src = await currentSource(userId, art, store);
  if (!src.ok) return src;
  const written = deliveredFor(src);
  // The person's words and the delivered page come from the server, never the
  // request; the server signs what it read itself. Only the person's own card
  // answers, kept terms and confirmations come from the page.
  const withEvidence = { ...(raw as Record<string, unknown>), ...ev, written, grounding: null, writerReceipt: writerReceipt(written, null) };
  const c = cleanRevisionInput(withEvidence);
  if (!c.ok) return { ok: false, status: c.reason === "too long" ? 413 : 400, reason: c.reason };
  const verdict = computeRevision(c.input);
  const r = await store.insertRevision(userId, revisionRecord(artifactId, "forge_finish", c.input, verdict));
  if (r.status === "not_ready") return { ok: false, status: 503, reason: "not_ready" };
  if (r.status !== "saved") return { ok: false, status: r.status === "invalid" ? 400 : 500, reason: r.status === "invalid" ? r.reason : "failed" };
  if (!r.reused) {
    // The resume in the Refinery now shows the checked words, marked as
    // exactly this revision, so its downloads use it (R1's marker).
    const base = (art.content ?? null) as { meta?: { targetJob?: string; targetCompany?: string; jobListingUrl?: string } } | null;
    const doc = resumeTextToDocument(c.input.resumeText, base) as unknown as Record<string, unknown>;
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
