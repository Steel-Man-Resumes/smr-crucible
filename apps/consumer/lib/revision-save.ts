/**
 * Saving a revision (migration 081, Phase 5 lane R1). Server only.
 *
 *   saveFinishRevision  the Forge finish page (and the import on sign-in)
 *                       saves its whole state. The server cleans it, runs the
 *                       finish gate and the page measurement itself
 *                       (lib/revision-status.ts) and stores the result on the
 *                       person's Forge resume, creating that resume if it is
 *                       not there yet. The account's resume content is rebuilt
 *                       from the saved text (lib/revision-to-doc.ts), so a
 *                       skill cut on the finish page does not come back in the
 *                       Refinery. A locked baseline keeps its content; the
 *                       revision is still saved.
 *   saveEditRevision    an edit in the Refinery workspace: the new texts on
 *                       top of the artifact's newest revision, whose evidence
 *                       the SERVER carries over. No earlier revision: no
 *                       evidence, so the result is a draft.
 *
 * Same content as the newest revision: that revision comes back, no new row.
 * The store is passed in so tests run without a database.
 */

import type { ArtifactRevision, InsertRevisionResult, NewRevision, RevisionSource } from "@crucible/core/src/artifactRevision";
import { cleanRevisionInput, computeRevision, editInput, givenTextMark, inputFromRevision, revisionRecord, type RevisionEvidence, type RevisionVerdict } from "./revision-status";
import { readReceipt, writerSourceFrom, type WriterSource } from "./writer-receipt";
import { resumeTextToDocument } from "./revision-to-doc";
import { readMarker, withRevisionMarker } from "./revision-marker";
import { CREDENTIALS_KEY } from "./forge-path";
import { artifactText, ensureExportRevision } from "./revision-current";

export interface ArtifactLite {
  id: string;
  artifact_type: string;
  target_context: unknown;
  content: unknown;
  is_locked?: boolean;
  /** The artifact this one was made from (a fork or a Tailor output), the person's own. */
  parent_artifact_id?: string | null;
}

export interface RevisionStore {
  listResumeArtifacts(userId: string): Promise<ArtifactLite[]>;
  getArtifact(userId: string, artifactId: string): Promise<ArtifactLite | null>;
  createForgeArtifact(userId: string, content: Record<string, unknown>, laneTarget: string): Promise<{ id: string }>;
  updateArtifactContent(userId: string, artifactId: string, content: Record<string, unknown>): Promise<string>;
  insertRevision(userId: string, rec: NewRevision): Promise<InsertRevisionResult>;
  getLatestRevision(userId: string, artifactId: string): Promise<ArtifactRevision | null>;
  /**
   * The newest writer's receipt nonce recorded for the person's run, and
   * whether that run is theirs (reviews M-B). The real store always has it.
   */
  receiptState?(userId: string, runId: string): Promise<{ newestNonce: string | null; linked: boolean }>;
  /** The person's own words as the server holds them (review H2). The real store always has it. */
  serverSource?(userId: string, keepInsideLines: boolean): Promise<WriterSource | null>;
}

/** What the page is told about a saved revision. */
export interface SavedRevisionSummary {
  id: string;
  artifactId: string;
  number: number;
  status: "draft" | "finished";
  pageCount: number;
  pageLimit: number | null;
  lengthChoice: string;
  openItems: string[];
  lengthItem: string | null;
  contentHash: string;
  reused: boolean;
  createdAt: string;
  /**
   * Review M2. "kept_refinery": the account's resume had edits made in the
   * Refinery after its last saved version; they were saved as their own
   * revision and the resume was NOT rewritten. "kept_earlier": an older copy
   * (from before saved versions) was saved as a revision, then the resume was
   * rewritten to this finished version. Absent: nothing to tell.
   */
  accountCopy?: "kept_refinery" | "kept_earlier";
  /** The revision the Refinery content was saved as, when accountCopy is set. */
  accountCopyRevision?: number;
}

export type SaveResult = { ok: true; revision: SavedRevisionSummary; usedRunReceipt?: boolean } | { ok: false; status: number; reason: string };

function summary(rev: ArtifactRevision, v: RevisionVerdict | null, reused: boolean): SavedRevisionSummary {
  return {
    id: rev.id,
    artifactId: rev.artifact_id,
    number: rev.revision_number,
    status: rev.status,
    pageCount: rev.page_count,
    pageLimit: rev.page_limit,
    lengthChoice: rev.length_choice,
    openItems: Array.isArray(rev.open_items) ? rev.open_items : [],
    lengthItem: v?.lengthItem ?? null,
    contentHash: rev.content_hash,
    reused,
    createdAt: rev.created_at,
  };
}

const isForge = (a: ArtifactLite) => a.artifact_type === "resume" && (a.target_context as { source?: unknown } | null)?.source === "forge";

/**
 * The person's Forge resume: the original one. A fork of it copies its
 * "forge" source tag, so the original (no parent) wins, then the newest.
 */
export function pickForgeArtifact<T extends ArtifactLite>(list: T[]): T | null {
  return list.find((a) => isForge(a) && !a.parent_artifact_id) ?? list.find(isForge) ?? null;
}

function failed(r: InsertRevisionResult): SaveResult {
  if (r.status === "not_ready") return { ok: false, status: 503, reason: "not_ready" };
  if (r.status === "invalid") return { ok: false, status: r.reason === "artifact not found" ? 404 : r.reason === "too large" ? 413 : 400, reason: r.reason };
  return { ok: false, status: 500, reason: "failed" };
}

export async function saveFinishRevision(
  userId: string,
  raw: unknown,
  opts: {
    source: Extract<RevisionSource, "forge_finish" | "forge_import">;
    laneTarget?: string;
    /** The request's signed-out run cookie, hashed (lib/writer-receipt.ts runCookieHash). */
    cookieHash?: string | null;
    /** Server code only (lib/lane-first-save.ts): this page was saved exactly as the person gave it. */
    givenAsIs?: boolean;
  },
  store: RevisionStore
): Promise<SaveResult> {
  // What the server knows (reviews M-B, H2): the receipt's run (newest
  // generation, is it the account's), the person's own words as stored, and
  // their newest verified revision.
  const r0 = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meta = readReceipt(r0.writerReceipt);
  const state = meta?.run && store.receiptState ? await store.receiptState(userId, meta.run) : { newestNonce: null, linked: !store.receiptState };
  const serverSource = store.serverSource ? await store.serverSource(userId, r0.keepInsideLines === true) : null;
  const artifacts = await store.listResumeArtifacts(userId);
  let forge = pickForgeArtifact(artifacts);
  const newestOwn = forge ? await store.getLatestRevision(userId, forge.id) : null;
  const knownEv = newestOwn && (newestOwn.evidence as Record<string, unknown> | null)?.writerVerified === true ? (newestOwn.evidence as unknown as RevisionEvidence) : null;
  // The known revision's own run: a newer generation recorded since then means
  // it no longer stands in (review r3 L-1).
  const knownRun = knownEv ? readReceipt(knownEv.writerReceipt)?.run : undefined;
  const knownNewestNonce = knownRun && store.receiptState ? (await store.receiptState(userId, knownRun)).newestNonce : null;
  const c = cleanRevisionInput(raw, {
    receipt: {
      userId,
      // The run being finished, as the page names it; the receipt's run must equal it.
      runId: typeof r0.runId === "string" ? r0.runId : "",
      newestNonce: state.newestNonce,
      runLinked: state.linked,
      cookieHash: opts.cookieHash ?? null,
    },
    serverSource,
    known: knownEv,
    knownNewestNonce,
  });
  if (!c.ok) return { ok: false, status: c.reason === "too long" ? 413 : 400, reason: c.reason };
  // Phase 6 (S1 round 2): the server marks a page saved as given, from its own call, never a request.
  if (opts.givenAsIs === true) c.input.evidence.givenAsIs = givenTextMark(c.input.resumeText);
  const verdict = computeRevision(c.input);

  let created = false;
  if (!forge) {
    const content = resumeTextToDocument(c.input.resumeText) as unknown as Record<string, unknown>;
    const made = await store.createForgeArtifact(userId, content, (opts.laneTarget ?? "").slice(0, 200));
    forge = { id: made.id, artifact_type: "resume", target_context: { source: "forge" }, content };
    created = true;
  }
  // Review M2, never erase: before anything rewrites the account's resume,
  // whatever it holds that is not already a saved version is saved as one.
  // Content the server itself wrote from a finish revision (marker kind
  // "finish", still intact) is already saved, so it may be rewritten.
  let accountCopy: SavedRevisionSummary["accountCopy"];
  let accountCopyRevision: number | undefined;
  let rewrite = true;
  if (!created) {
    const marker = readMarker(forge.content);
    // Written by the server (from a finish revision, or derived from the run's
    // earlier inputs by the Forge save) and untouched since: nothing of the
    // person's would be lost, so it may be rewritten.
    const serverWritten = !!marker && marker.hashOk && (marker.kind === "finish" || marker.kind === "derived");
    if (marker && marker.hashOk && marker.kind === "edit") {
      // The person's Refinery copy, already saved as its own revision: keep it.
      accountCopy = "kept_refinery";
      rewrite = false;
    } else if (!serverWritten && artifactText(forge.content).trim()) {
      const kept = await ensureExportRevision(userId, forge.id, store);
      if (!kept.ok) return kept;
      accountCopyRevision = kept.revision.revision_number;
      if (marker) {
        // Revision-era content the person edited in the Refinery: keep it as
        // their working copy; this finished version is saved beside it.
        accountCopy = "kept_refinery";
        rewrite = false;
      } else {
        // An older copy from before saved versions: kept as a revision, then
        // the resume shows the finished words.
        accountCopy = "kept_earlier";
      }
    }
  }
  const r = await store.insertRevision(userId, revisionRecord(forge.id, opts.source, c.input, verdict));
  if (r.status !== "saved") return failed(r);
  // The account's resume shows the saved words (lock-guarded by the write
  // itself), marked as exactly this revision so every Refinery export of it
  // uses this revision (lib/revision-current.ts).
  if (rewrite && (!r.reused || created || accountCopy)) {
    const base = (forge.content ?? null) as { meta?: { targetJob?: string; targetCompany?: string; jobListingUrl?: string } } | null;
    const doc = resumeTextToDocument(c.input.resumeText, base) as unknown as Record<string, unknown>;
    await store
      .updateArtifactContent(userId, forge.id, withRevisionMarker(doc, r.revision.id, { formatted: artifactText(doc), kind: "finish" }))
      .catch(() => "failed");
  }
  // A signed-out run's receipt, used for this account: the route clears the
  // run cookie so no other account can import it (review r3 L-1).
  const usedRunReceipt = c.input.evidence.writerVerified && (readReceipt(c.input.evidence.writerReceipt)?.sub ?? "").startsWith("r:");
  return {
    ok: true,
    revision: { ...summary(r.revision, verdict, r.reused), ...(accountCopy ? { accountCopy, accountCopyRevision } : {}) },
    ...(usedRunReceipt ? { usedRunReceipt: true } : {}),
  };
}

export async function saveEditRevision(
  userId: string,
  artifactId: string,
  resumeText: unknown,
  letterText: unknown,
  store: RevisionStore,
  opts: { base?: ArtifactRevision | null } = {}
): Promise<SaveResult> {
  if (typeof resumeText !== "string" || !resumeText.trim()) return { ok: false, status: 400, reason: "no resume" };
  if (letterText !== undefined && typeof letterText !== "string") return { ok: false, status: 400, reason: "bad letter" };
  const art = await store.getArtifact(userId, artifactId);
  if (!art || art.artifact_type !== "resume") return { ok: false, status: 404, reason: "artifact not found" };
  // The revision this edit starts from: given by the caller (the export, which
  // may have walked to a parent), else this artifact's newest.
  const latest = opts.base !== undefined ? opts.base : await store.getLatestRevision(userId, artifactId);
  const base = latest ? inputFromRevision(latest) : null;
  const c = editInput(base, resumeText, letterText as string | undefined);
  if (!c.ok) return { ok: false, status: c.reason === "too long" ? 413 : 400, reason: c.reason };
  const verdict = computeRevision(c.input);
  const r = await store.insertRevision(userId, revisionRecord(artifactId, "refinery_edit", c.input, verdict));
  if (r.status !== "saved") return failed(r);
  return { ok: true, revision: summary(r.revision, verdict, r.reused) };
}

/** The real store: packages/core, every call AS the person. */
export async function coreStore(): Promise<RevisionStore> {
  const core = await import("@crucible/core");
  return {
    listResumeArtifacts: (userId) => core.listArtifacts(userId, { type: "resume", examples: "hide", limit: 50 }) as Promise<ArtifactLite[]>,
    getArtifact: (userId, id) => core.getArtifact(id, userId) as Promise<ArtifactLite | null>,
    createForgeArtifact: async (userId, content, laneTarget) => {
      const made = await core.createArtifact(userId, "resume", { source: "forge", targetJob: "" }, content, 1.0);
      // The first finished Forge resume names the person's first lane, as the
      // Forge save does (best effort; a lane problem never fails the save).
      if (laneTarget && !core.looksLikeExampleResume(content)) {
        try {
          const lane = await core.ensureFirstLane(userId, laneTarget);
          if (lane) await core.setArtifactLane(userId, made.id, lane.id);
        } catch {
          // fine
        }
      }
      return { id: made.id };
    },
    updateArtifactContent: async (userId, id, content) => (await core.updateArtifact(id, userId, content)).status,
    insertRevision: (userId, rec) => core.insertRevision(userId, rec),
    getLatestRevision: (userId, id) => core.getLatestRevision(userId, id),
    receiptState: async (userId, runId) => ({
      newestNonce: await core.newestWriterReceiptNonce(userId, runId),
      linked: await core.runBelongsTo(userId, runId),
    }),
    // The person's stored upload and typed answers (consumer_profile), worked
    // out the same way the writer's inputs are.
    serverSource: async (userId, keepInsideLines) => {
      const p = await core.loadForgeProfile(userId);
      if (!p) return null;
      return writerSourceFrom({
        resumeText: p.resumeText,
        goalNarrative: p.goalNarrative,
        credentialsNote: p.challengeNarratives?.[CREDENTIALS_KEY],
        keepInsideLines,
      });
    },
  };
}
