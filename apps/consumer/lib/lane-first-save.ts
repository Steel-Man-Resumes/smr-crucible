/**
 * The first save on the lanes-first path (Phase 5 lane R2, review H2 and H3).
 * Server only.
 *
 * H2, NO CIRCULAR EVIDENCE. The page being saved is never its own evidence.
 * The server builds the save itself: the page, no card answers, and as the
 * person's own words ONLY what they typed on this screen (the duty they wrote
 * in "Build with me", the phone number they added as the one fix). Since R1
 * 335e68b the save works the person's words out on the server (their stored
 * upload and answers) and trusts none from a request, so the typed words are
 * at most a hint. Either way the page never counts as its own evidence, there
 * is no writer's receipt, and the gate keeps a first page a draft. The cards
 * on the finish page are the way to "finished".
 *
 * H3, NEVER LOSE A SAVED RESUME. Someone who already has a saved resume picks
 * what happens to it before anything is written:
 *   "new":     their saved resume is copied, word for word with its saved
 *              version (and the same status), into its own item in My
 *              resumes. The new work becomes the resume the Forge works on.
 *   "replace": the new work takes the main resume's place; the earlier
 *              version stays in its history and can be brought back from My
 *              resumes (restoreVersion).
 * With no saved resume there is nothing to ask ("first").
 *
 * Built only from R1's pieces (cleanRevisionInput, computeRevision, currentRevisionStatus,
 * revisionRecord, saveFinishRevision, the store); R1's own save, export and
 * email code is unchanged.
 */

import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
import { cleanRevisionInput, computeRevision, currentRevisionStatus, inputFromRevision, revisionRecord } from "./revision-status";
import { pickForgeArtifact, saveFinishRevision, type ArtifactLite, type RevisionStore, type SavedRevisionSummary } from "./revision-save";
import { resumeTextToDocument } from "./revision-to-doc";
import { artifactText, withRevisionMarker } from "./revision-current";

/** What a person can type on the first-save screens: a few short fields, never a page. */
export const MAX_TYPED_CHARS = 2000;

export type KeepChoice = "first" | "new" | "replace";

export interface LaneFirstStore extends RevisionStore {
  /** A new resume artifact of the person's own (never the Forge's "forge" tag). */
  createResumeArtifact(userId: string, targetContext: Record<string, unknown>, content: Record<string, unknown>): Promise<{ id: string }>;
  getRevision(userId: string, revisionId: string): Promise<ArtifactRevision | null>;
  listRevisions(userId: string, artifactId: string): Promise<ArtifactRevision[]>;
}

/** The save the server builds: the page, no answers, and only the typed words as the person's own. */
export function firstSaveState(text: string, typed: string) {
  return {
    resumeText: text,
    coverLetterText: "",
    defendAnswers: [],
    addedTerms: [],
    keptTerms: [],
    confirmedCredentials: [],
    credentialCutRemnants: [],
    written: null,
    grounding: null,
    withheldLines: [],
    keepInsideLines: false,
    recordChoice: "off",
    ownWords: typed,
    credentialsAnswer: "",
    credentialRows: [],
    ownResumeText: "",
    lengthChoice: "auto",
    docKind: "resume",
  };
}

export type FirstSaveResult =
  | { ok: true; revision: SavedRevisionSummary; keptCopyId: string | null }
  | { ok: false; status: number; reason: string };

function summary(rev: ArtifactRevision, reused: boolean): SavedRevisionSummary {
  return {
    id: rev.id,
    artifactId: rev.artifact_id,
    number: rev.revision_number,
    status: rev.status,
    pageCount: rev.page_count,
    pageLimit: rev.page_limit,
    lengthChoice: rev.length_choice,
    openItems: Array.isArray(rev.open_items) ? rev.open_items : [],
    lengthItem: null,
    contentHash: rev.content_hash,
    reused,
    createdAt: rev.created_at,
  };
}

/** The person's main (Forge) resume and its newest saved version, if any. */
export async function savedMain(userId: string, store: RevisionStore): Promise<{ art: ArtifactLite; rev: ArtifactRevision } | null> {
  const art = pickForgeArtifact(await store.listResumeArtifacts(userId));
  if (!art) return null;
  const rev = await store.getLatestRevision(userId, art.id);
  return rev ? { art, rev: currentRevisionStatus(rev) } : null;
}

/** Same words, same answers, same evidence: a new version computed again (so the same status). */
async function copyRevision(userId: string, artifactId: string, from: ArtifactRevision, store: RevisionStore): Promise<{ ok: true; rev: ArtifactRevision; reused: boolean } | { ok: false; status: number; reason: string }> {
  const input = inputFromRevision(from);
  if (!input) return { ok: false, status: 409, reason: "unreadable version" };
  const verdict = computeRevision(input);
  const r = await store.insertRevision(userId, revisionRecord(artifactId, from.source, input, verdict));
  if (r.status === "not_ready") return { ok: false, status: 503, reason: "not_ready" };
  if (r.status !== "saved") return { ok: false, status: 400, reason: r.status === "invalid" ? r.reason : "failed" };
  return { ok: true, rev: r.revision, reused: r.reused };
}

/** Write an artifact's content as exactly this revision (R1's marker, "finish" kind). */
async function markContent(userId: string, artifactId: string, text: string, base: unknown, revId: string, store: RevisionStore): Promise<string> {
  const doc = resumeTextToDocument(text, (base ?? null) as never) as unknown as Record<string, unknown>;
  return store.updateArtifactContent(userId, artifactId, withRevisionMarker(doc, revId, { formatted: artifactText(doc), kind: "finish" })).catch(() => "failed");
}

/** Copy the main resume, word for word with its newest version, into its own item in My resumes. */
export async function keepCopyOfMain(userId: string, store: LaneFirstStore): Promise<{ ok: true; id: string | null } | { ok: false; status: number; reason: string }> {
  const main = await savedMain(userId, store);
  if (!main) return { ok: true, id: null };
  const tc = (main.art.target_context ?? {}) as { targetJob?: unknown };
  const made = await store.createResumeArtifact(
    userId,
    { source: "kept", keptFrom: main.art.id, targetJob: typeof tc.targetJob === "string" && tc.targetJob.trim() ? tc.targetJob : "Your earlier resume" },
    resumeTextToDocument(main.rev.resume_text, main.art.content as never) as unknown as Record<string, unknown>
  );
  const copied = await copyRevision(userId, made.id, main.rev, store);
  if (!copied.ok) return copied;
  await markContent(userId, made.id, copied.rev.resume_text, main.art.content, copied.rev.id, store);
  return { ok: true, id: made.id };
}

/**
 * The first save. `keep` must be "new" or "replace" when the person already
 * has a saved resume (the screen asks); refused otherwise, so nothing is ever
 * replaced without their answer.
 */
export async function saveFirstSection(
  userId: string,
  input: { text: unknown; typed: unknown; keep: unknown; laneTarget?: unknown },
  store: LaneFirstStore
): Promise<FirstSaveResult> {
  const text = typeof input.text === "string" ? input.text : "";
  if (!text.trim()) return { ok: false, status: 400, reason: "no resume" };
  const typed = typeof input.typed === "string" ? input.typed.slice(0, MAX_TYPED_CHARS) : "";
  const keep: KeepChoice = input.keep === "new" || input.keep === "replace" ? input.keep : "first";
  const main = await savedMain(userId, store);
  if (main && keep === "first") return { ok: false, status: 409, reason: "ask_keep" };
  const c = cleanRevisionInput(firstSaveState(text, typed));
  if (!c.ok) return { ok: false, status: c.reason === "too long" ? 413 : 400, reason: c.reason };
  let keptCopyId: string | null = null;
  if (main && keep === "new") {
    const kept = await keepCopyOfMain(userId, store);
    if (!kept.ok) return kept;
    keptCopyId = kept.id;
  }
  const saved = await saveFinishRevision(
    userId,
    firstSaveState(text, typed),
    // Phase 6 (S1 round 2): saved exactly as the person gave it (their upload or their typed section).
    { source: "forge_finish", laneTarget: typeof input.laneTarget === "string" ? input.laneTarget.slice(0, 200) : "", givenAsIs: true },
    store
  );
  if (!saved.ok) return saved;
  return { ok: true, revision: saved.revision, keptCopyId };
}

export interface VersionView {
  id: string;
  number: number;
  status: "draft" | "finished";
  createdAt: string;
  /** The first lines, so the person can tell versions apart. */
  preview: string;
}

/** Every saved version of one of the person's resumes, newest first. */
export async function listVersions(userId: string, artifactId: string, store: LaneFirstStore): Promise<VersionView[] | null> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art || art.artifact_type !== "resume") return null;
  const revs = await store.listRevisions(userId, artifactId);
  return revs
    .sort((a, b) => b.revision_number - a.revision_number)
    .map((r) => ({
      id: r.id,
      number: r.revision_number,
      status: currentRevisionStatus(r).status,
      createdAt: r.created_at,
      preview: r.resume_text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" / ").slice(0, 160),
    }));
}

/** Bring an earlier version back: a new version with its exact words, answers and evidence. */
export async function restoreVersion(userId: string, artifactId: string, revisionId: string, store: LaneFirstStore): Promise<FirstSaveResult> {
  const art = await store.getArtifact(userId, artifactId);
  if (!art || art.artifact_type !== "resume") return { ok: false, status: 404, reason: "artifact not found" };
  if (art.is_locked) return { ok: false, status: 409, reason: "locked" };
  const from = await store.getRevision(userId, revisionId);
  if (!from || from.artifact_id !== artifactId) return { ok: false, status: 404, reason: "version not found" };
  const copied = await copyRevision(userId, artifactId, from, store);
  if (!copied.ok) return copied;
  const wrote = await markContent(userId, artifactId, copied.rev.resume_text, art.content, copied.rev.id, store);
  if (wrote === "locked") return { ok: false, status: 409, reason: "locked" };
  return { ok: true, revision: summary(copied.rev, copied.reused), keptCopyId: null };
}

/** The real store: R1's, plus the three reads and writes this needs, every call AS the person. */
export async function laneFirstStore(): Promise<LaneFirstStore> {
  const { coreStore } = await import("./revision-save");
  const base = await coreStore();
  const core = await import("@crucible/core");
  return {
    ...base,
    createResumeArtifact: async (userId, targetContext, content) => ({ id: (await core.createArtifact(userId, "resume", targetContext, content, 1.0)).id }),
    getRevision: (userId, id) => core.getRevision(userId, id),
    listRevisions: async (userId, artifactId) => (await core.exportRevisions(userId)).filter((r) => r.artifact_id === artifactId),
  };
}
