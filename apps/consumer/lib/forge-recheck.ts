/**
 * "Check it again": ONE server path that re-checks a version for real and
 * signs a fresh writer's receipt (Phase 5 R1, review r3 M-1). Server only.
 *
 * Two inputs, one rule:
 *   { kind: "finish", documents, source, answers?, runId }
 *       The finish page's current documents (signed in or out). Used when a
 *       finished page's receipt is missing or no longer accepted (a finish
 *       from before receipts, a rotated key past its grace, a run cookie that
 *       is gone).
 *   { kind: "artifact", artifactId }
 *       Signed in only: one of the person's own resumes (ownership checked by
 *       reading it AS them). For R2's "Check and finish" on Tailor outputs,
 *       older Refinery resumes and pre-finish builder output. The text is read
 *       ON THE SERVER: the stored resume, as an export would print it
 *       (lib/revision-current.ts), its letter from the newest revision.
 *
 * Both run the second check for real (verifyGrounding, the same verifier as
 * generate-docs) on those documents, against the person's own words (their
 * source and the answers they gave), measure every flag against the documents
 * as they are (nothing is rewritten, every answer stays), and sign a fresh
 * wr2 receipt bound as usual: account (or run cookie), run, the server-worked
 * source, nonce, time. Signed in, the nonce is recorded as the run's newest.
 *
 * NEVER TRUSTED FROM A REQUEST: written documents, grounding, or a receipt.
 * Whatever a request sends under those names is ignored. The receipt's
 * "written" documents are the documents that were checked.
 *
 * The artifact path also saves the checked version as the artifact's new
 * revision (status from the gate, as always), so a second check that BLOCKs
 * keeps it a draft with that line as its card.
 *
 * The verifier and the store are passed in, so tests never reach a model or a
 * database.
 */

import { buildTrustedSource } from "./grounding-verify";
import type { verifyGrounding as VerifyFn } from "./grounding-verify";
import { accountFlags } from "./grounding-accounting";
import { credentialStatuses, findOverstatedCredentialLines, findOverstatedCredentials } from "./credential-truth";
import { plainPunctuationText } from "./legal-sanitize";
import { MAX_RENDER_CHARS } from "./resume-render";
import { writerReceipt, writerSourceFrom, type WriterSource } from "./writer-receipt";
import { computeRevision, editInput, inputFromRevision, revisionRecord, type RevisionEvidence } from "./revision-status";
import { artifactText, baseRevisionFor, textFromBase } from "./revision-current";
import type { RevisionStore, SavedRevisionSummary } from "./revision-save";

export interface RecheckDeps {
  verify: typeof VerifyFn;
  /** Signed in: keep the newest nonce for the run (packages/core recordWriterReceipt). */
  record?: (userId: string, runId: string, nonce: string, issuedAtMs: number) => Promise<void>;
  /** A fresh random nonce and run-cookie value (tests pass fixed ones). */
  random: () => string;
  now?: () => number;
  /** The artifact path's reads and its revision save (lib/revision-save.ts coreStore). */
  store?: RevisionStore;
}

/** What a check returns. The artifact path also returns the revision it saved. */
export type RecheckResult =
  | {
      ok: true;
      grounding: Record<string, unknown>;
      receipt: string;
      /** The documents that were checked: the receipt's "written". */
      written: { resume: string; letter: string };
      /** Signed out: the new run cookie the route sets (HttpOnly). */
      runCookie: string | null;
      revision?: SavedRevisionSummary;
    }
  | { ok: false; status: number; error: string };

const isDoc = (v: unknown): v is { resume: string; letter: string } =>
  !!v && typeof v === "object" && typeof (v as { resume?: unknown }).resume === "string" && typeof (v as { letter?: unknown }).letter === "string";

/** Run the second check on documents, nothing rewritten. */
async function runCheck(
  docs: { resume: string; letter: string },
  own: { resumeText?: string; goalNarrative?: string; goals?: string[]; credentialsNote?: string; extra: string[] },
  verify: typeof VerifyFn
): Promise<Record<string, unknown>> {
  const groundingSource = buildTrustedSource({
    resumeText: own.resumeText,
    userText: [own.goalNarrative, (own.goals ?? []).join(", ") || undefined, own.credentialsNote?.slice(0, 1000), ...own.extra],
  });
  const [rc, cc] = await Promise.all([
    verify({ sourceText: groundingSource, output: docs.resume, kind: "resume" }),
    verify({ sourceText: groundingSource, output: docs.letter, kind: "cover_letter" }),
  ]);
  const accounting = accountFlags([
    { doc: "resume", flags: rc.flags, original: docs.resume, final: docs.resume },
    { doc: "cover_letter", flags: cc.flags, original: docs.letter, final: docs.letter },
  ]);
  const statuses = credentialStatuses(groundingSource);
  const clean = (claim: string) => plainPunctuationText(claim).text.slice(0, 200);
  const known = new Set(accounting.outcomes.map((o) => `${o.doc}|${o.claim.toLowerCase()}`));
  const credentialChecks = [
    ...findOverstatedCredentialLines(docs.resume, statuses).map((claim) => ({ claim, doc: "resume" as const })),
    ...findOverstatedCredentials(docs.letter, statuses, { firstPerson: true }).map((claim) => ({ claim, doc: "cover_letter" as const })),
  ];
  const outcomes = [
    ...accounting.outcomes,
    ...credentialChecks
      .filter((c) => !known.has(`${c.doc}|${clean(c.claim).toLowerCase()}`))
      .map((c) => ({ claim: clean(c.claim), doc: c.doc, status: "credential" as const })),
  ];
  return {
    hasFabrication: rc.hasFabrication || cc.hasFabrication,
    applied: false,
    removed: 0,
    residual: outcomes.filter((o) => o.status === "still_there" || o.status === "changed" || o.status === "also_in").length,
    flags: [...rc.flags, ...cc.flags],
    outcomes,
    verifierRan: rc.verifierRan && cc.verifierRan,
    verifierRanByDoc: { resume: rc.verifierRan, cover_letter: cc.verifierRan },
    hasFabricationByDoc: { resume: rc.hasFabrication, cover_letter: cc.hasFabrication },
    unnamedByDoc: {
      resume: rc.hasFabrication && !rc.flags.some((f) => f.claim.trim()),
      cover_letter: cc.hasFabrication && !cc.flags.some((f) => f.claim.trim()),
    },
    changed: accounting.changed,
    unmatched: accounting.unmatched,
    rechecked: true,
  };
}

function sign(
  written: { resume: string; letter: string },
  grounding: Record<string, unknown>,
  userId: string | null,
  runId: string,
  source: WriterSource,
  deps: RecheckDeps
): { receipt: string; nonce: string; now: number; runCookie: string | null } {
  const nonce = deps.random();
  const now = (deps.now ?? Date.now)();
  const runCookie = userId ? null : deps.random();
  const receipt = writerReceipt(written, grounding, { userId, runId, source, nonce, now, ...(runCookie ? { cookie: runCookie } : {}) });
  return { receipt, nonce, now, runCookie };
}

/** The run a stored artifact's check is bound to (an artifact has no Forge run of its own). */
export function artifactRunId(artifactId: string): string {
  return `artifact:${artifactId}`;
}

/**
 * Check it again. `input` is the parsed request body: { kind: "finish", ... }
 * or { kind: "artifact", artifactId }. A body with no kind is a finish state.
 */
export async function recheckDocs(input: unknown, userId: string | null, deps: RecheckDeps): Promise<RecheckResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400, error: "Invalid request" };
  const b = input as Record<string, unknown>;
  if (b.kind === "artifact") return recheckArtifact(b, userId, deps);

  // ---- a finish state ----
  const docs = b.documents;
  const source = (b.source && typeof b.source === "object" ? b.source : {}) as Record<string, unknown>;
  const runId = typeof b.runId === "string" ? b.runId.slice(0, 100) : "";
  if (!isDoc(docs) || !docs.resume.trim() || !runId) return { ok: false, status: 400, error: "Nothing to check yet." };
  if (docs.resume.length > MAX_RENDER_CHARS || docs.letter.length > MAX_RENDER_CHARS) {
    return { ok: false, status: 413, error: "That is longer than a resume or letter can be." };
  }
  const written = { resume: docs.resume, letter: docs.letter };
  const answers = Array.isArray(b.answers) ? b.answers.filter((a): a is string => typeof a === "string").slice(0, 400).map((a) => a.slice(0, 2000)) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const grounding = await runCheck(
    written,
    {
      resumeText: str(source.resumeText),
      goalNarrative: str(source.goalNarrative),
      goals: Array.isArray(source.goals) ? source.goals.filter((g): g is string => typeof g === "string") : [],
      credentialsNote: str(source.credentialsNote),
      extra: answers,
    },
    deps.verify
  );
  const signed = sign(written, grounding, userId, runId, writerSourceFrom(source), deps);
  if (userId && deps.record) await deps.record(userId, runId, signed.nonce, signed.now);
  return { ok: true, grounding, receipt: signed.receipt, written, runCookie: signed.runCookie };
}

async function recheckArtifact(b: Record<string, unknown>, userId: string | null, deps: RecheckDeps): Promise<RecheckResult> {
  if (!userId) return { ok: false, status: 401, error: "Sign in to check a saved resume." };
  const store = deps.store;
  if (!store) return { ok: false, status: 500, error: "We couldn't check it just now." };
  const artifactId = typeof b.artifactId === "string" ? b.artifactId : "";
  // Read AS the person: someone else's resume is simply not there.
  const art = artifactId ? await store.getArtifact(userId, artifactId) : null;
  if (!art || art.artifact_type !== "resume") return { ok: false, status: 404, error: "We could not find that resume." };
  const base = await baseRevisionFor(userId, art, store);
  // The stored text, as an export would print it (never a request's text).
  const resume = base ? textFromBase(art.content, base) : artifactText(art.content);
  if (!resume.trim()) return { ok: false, status: 409, error: "There is no resume text to check." };
  if (resume.length > MAX_RENDER_CHARS) return { ok: false, status: 413, error: "That is longer than a resume or letter can be." };
  const letter = base?.letter_text ?? "";
  const written = { resume, letter };

  // The person's own words, as the server holds them: the base revision's
  // stored evidence (when it was verified), else their stored upload and answers.
  const baseInput = base ? inputFromRevision(base) : null;
  const ev = baseInput?.evidence;
  const held: WriterSource | null =
    ev && ev.writerVerified
      ? { ownWords: ev.ownWords, ownResumeText: ev.ownResumeText, credentialsAnswer: ev.credentialsAnswer, credentialRows: ev.credentialRows }
      : store.serverSource
        ? await store.serverSource(userId, false)
        : null;
  const source: WriterSource = held ?? { ownWords: "", ownResumeText: "", credentialsAnswer: "", credentialRows: [] };
  const answers = [
    ...(baseInput?.defendAnswers ?? []).map((a) => a.answer),
    ...(baseInput?.confirmedCredentials ?? []).map((c) => c.text),
    ...(baseInput?.keptTerms ?? []),
  ];
  const grounding = await runCheck(written, { resumeText: [source.ownResumeText, source.ownWords].filter(Boolean).join("\n\n"), extra: answers }, deps.verify);
  const runId = artifactRunId(art.id);
  const signed = sign(written, grounding, userId, runId, source, deps);
  if (deps.record) await deps.record(userId, runId, signed.nonce, signed.now);

  // Save the checked version (server-made evidence, so it is stored as verified).
  const edited = editInput(baseInput, resume, letter);
  if (!edited.ok) return { ok: false, status: edited.reason === "too long" ? 413 : 400, error: "We couldn't check it just now." };
  const evidence: RevisionEvidence = {
    ...edited.input.evidence,
    ownWords: source.ownWords,
    ownResumeText: source.ownResumeText,
    credentialsAnswer: source.credentialsAnswer,
    credentialRows: source.credentialRows,
    written,
    grounding,
    writerReceipt: signed.receipt,
    writerVerified: true,
    runId,
  };
  const checked = { ...edited.input, evidence };
  const verdict = computeRevision(checked);
  const saved = await store.insertRevision(userId, revisionRecord(art.id, "refinery_edit", checked, verdict));
  if (saved.status !== "saved") return { ok: false, status: saved.status === "not_ready" ? 503 : 400, error: "We couldn't save the checked version." };
  const rev = saved.revision;
  return {
    ok: true,
    grounding,
    receipt: signed.receipt,
    written,
    runCookie: null,
    revision: {
      id: rev.id,
      artifactId: rev.artifact_id,
      number: rev.revision_number,
      status: rev.status,
      pageCount: rev.page_count,
      pageLimit: rev.page_limit,
      lengthChoice: rev.length_choice,
      openItems: Array.isArray(rev.open_items) ? rev.open_items : [],
      lengthItem: verdict.lengthItem,
      contentHash: rev.content_hash,
      reused: saved.reused,
      createdAt: rev.created_at,
    },
  };
}
