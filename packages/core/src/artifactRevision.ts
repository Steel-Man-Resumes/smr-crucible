/**
 * Saved resume revisions (migration 081, Phase 5 lane R1). Server only.
 *
 * One revision is one saved version of a resume artifact: the resume text,
 * the letter text, the person's confirmations, the evidence the finish gate
 * reads, the checker version, and the status and page count the SERVER
 * worked out. Every export path (downloads, print, quick-apply, the automatic
 * email) reads a revision by id and decides DRAFT from its stored status;
 * nothing trusts a page's "finished" flag.
 *
 * This module only stores and reads. It never decides a status: the caller
 * (apps/consumer/lib/revision-status.ts) runs the finish gate and the page
 * measurement, then hands the result here. The table's CHECKs refuse a
 * "finished" row that is over its page limit or has open items, whatever
 * calls it.
 *
 * Every read and write runs AS the owner (queryAsUser / getOneAsUser): the
 * table is owner-only under FORCE row-level security, and its composite
 * foreign key (artifact_id, user_id) means a revision can only hang off an
 * artifact the same person holds. Rows are never edited; a change is a new
 * revision. Before 081 is applied the table is missing (42P01) and every
 * function here says so instead of throwing.
 */

import { createHash } from "node:crypto";
import { queryAsUser, getOneAsUser, getOne } from "./db";

export const REVISION_SOURCES = ["forge_finish", "forge_import", "refinery_edit"] as const;
export type RevisionSource = (typeof REVISION_SOURCES)[number];

export const REVISION_DOC_KINDS = ["resume", "cv_academic", "cv_clinical", "cv_international", "artist_resume", "performer_resume"] as const;
export type RevisionDocKind = (typeof REVISION_DOC_KINDS)[number];

export const LENGTH_CHOICES = ["auto", "one_page", "two_pages"] as const;
export type LengthChoice = (typeof LENGTH_CHOICES)[number];

export type RevisionStatus = "draft" | "finished";

export const REVISION_MAX_TEXT = 60_000;

/** Most revisions kept per artifact. Older ones are pruned; the newest finished one never is. */
export const REVISION_KEEP_PER_ARTIFACT = 50;

/** The table's size CHECKs, in bytes of JSON text (migration 081). */
export const REVISION_JSON_LIMITS = {
  keptTerms: 20_000,
  confirmedCredentials: 60_000,
  defendAnswers: 400_000,
  evidence: 600_000,
  openItems: 40_000,
} as const;

/** The page limit each kind may carry (the 081 CHECK artifact_revision_limit_by_kind). */
export function pageLimitAllowed(kind: RevisionDocKind, limit: number | null): boolean {
  if (kind === "cv_academic" || kind === "cv_clinical") return limit === null;
  if (kind === "performer_resume") return limit === 1;
  if (kind === "artist_resume") return limit === 1 || limit === 2 || limit === 4;
  return limit === 1 || limit === 2;
}

/** Byte length of a value as the database will store it (JSON text, UTF-8). */
function jsonBytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the caller hands in: everything the server worked out, nothing from a client flag. */
export interface NewRevision {
  artifactId: string;
  source: RevisionSource;
  docKind: RevisionDocKind;
  resumeText: string;
  letterText: string;
  keptTerms: unknown[];
  confirmedCredentials: unknown[];
  defendAnswers: unknown[];
  evidence: Record<string, unknown>;
  checkerVersion: string;
  status: RevisionStatus;
  pageCount: number;
  pageLimit: number | null;
  lengthChoice: LengthChoice;
  openItems: string[];
}

export interface ArtifactRevision {
  id: string;
  user_id: string;
  artifact_id: string;
  revision_number: number;
  source: RevisionSource;
  doc_kind: RevisionDocKind;
  resume_text: string;
  letter_text: string;
  kept_terms: unknown[];
  confirmed_credentials: unknown[];
  defend_answers: unknown[];
  evidence: Record<string, unknown>;
  checker_version: string;
  status: RevisionStatus;
  page_count: number;
  page_limit: number | null;
  length_choice: LengthChoice;
  open_items: string[];
  content_hash: string;
  created_at: string;
}

/** Stable JSON: object keys sorted, so the same content always hashes the same. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

/**
 * The version fingerprint: SHA-256 hex over everything that defines a
 * revision (texts, confirmations, evidence, the computed status and pages,
 * the rule that applied, the checker version). Not the source: saving the
 * same finished resume from the import and from the page is one version.
 */
export function revisionContentHash(r: Omit<NewRevision, "artifactId" | "source">): string {
  return createHash("sha256")
    .update(
      stableJson({
        k: r.docKind,
        r: r.resumeText,
        l: r.letterText,
        kt: r.keptTerms,
        cc: r.confirmedCredentials,
        da: r.defendAnswers,
        ev: r.evidence,
        cv: r.checkerVersion,
        st: r.status,
        pc: r.pageCount,
        pl: r.pageLimit,
        lc: r.lengthChoice,
        oi: r.openItems,
      })
    )
    .digest("hex");
}

/** Refuses anything the table would refuse, before a round trip. Returns a reason or null. */
export function revisionProblem(r: NewRevision): string | null {
  if (!UUID_RE.test(r.artifactId)) return "bad artifact id";
  if (!(REVISION_SOURCES as readonly string[]).includes(r.source)) return "bad source";
  if (!(REVISION_DOC_KINDS as readonly string[]).includes(r.docKind)) return "bad kind";
  if (!(LENGTH_CHOICES as readonly string[]).includes(r.lengthChoice)) return "bad length choice";
  if (typeof r.resumeText !== "string" || !r.resumeText.trim() || r.resumeText.length > REVISION_MAX_TEXT) return "bad resume text";
  if (typeof r.letterText !== "string" || r.letterText.length > REVISION_MAX_TEXT) return "bad letter text";
  if (r.status !== "draft" && r.status !== "finished") return "bad status";
  if (!Number.isInteger(r.pageCount) || r.pageCount < 0 || r.pageCount > 99) return "bad page count";
  if (r.pageLimit !== null && (!Number.isInteger(r.pageLimit) || r.pageLimit < 1 || r.pageLimit > 99)) return "bad page limit";
  if (!pageLimitAllowed(r.docKind, r.pageLimit)) return "page limit does not fit the kind";
  // Over a size CHECK: refused here with a plain reason, never a retry loop.
  if (
    jsonBytes(r.keptTerms) > REVISION_JSON_LIMITS.keptTerms ||
    jsonBytes(r.confirmedCredentials) > REVISION_JSON_LIMITS.confirmedCredentials ||
    jsonBytes(r.defendAnswers) > REVISION_JSON_LIMITS.defendAnswers ||
    jsonBytes(r.evidence) > REVISION_JSON_LIMITS.evidence ||
    jsonBytes(r.openItems) > REVISION_JSON_LIMITS.openItems
  ) {
    return "too large";
  }
  if (r.status === "finished") {
    if (r.pageCount < 1 || (r.pageLimit !== null && r.pageCount > r.pageLimit)) return "finished over the page limit";
    if (r.openItems.length > 0) return "finished with open items";
  }
  return null;
}

/** Postgres "relation does not exist": 081 is not applied yet. */
export function revisionTableMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

const COLUMNS = `id, user_id, artifact_id, revision_number, source, doc_kind, resume_text, letter_text,
  kept_terms, confirmed_credentials, defend_answers, evidence, checker_version, status,
  page_count, page_limit, length_choice, open_items, content_hash, created_at`;

/*
 * SQL kept as constants so the PGlite suite runs the exact text core sends.
 *
 * The insert assigns the next number and skips a duplicate in ONE statement:
 * when the artifact's newest revision already has this content hash, nothing
 * is written (the caller reads that revision back). Two saves racing for the
 * same number: one wins, the other gets no row from ON CONFLICT and retries.
 */
export const REVISION_INSERT_SQL = `INSERT INTO artifact_revision
    (user_id, artifact_id, revision_number, source, doc_kind, resume_text, letter_text,
     kept_terms, confirmed_credentials, defend_answers, evidence, checker_version, status,
     page_count, page_limit, length_choice, open_items, content_hash)
  SELECT $1, $2,
         COALESCE((SELECT max(r.revision_number) FROM artifact_revision r WHERE r.artifact_id = $2 AND r.user_id = $1), 0) + 1,
         $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb, $17
   WHERE NOT EXISTS (
     SELECT 1 FROM (
       SELECT r.content_hash FROM artifact_revision r
        WHERE r.artifact_id = $2 AND r.user_id = $1
        ORDER BY r.revision_number DESC LIMIT 1
     ) newest WHERE newest.content_hash = $17)
  ON CONFLICT (artifact_id, revision_number) DO NOTHING
  RETURNING ${COLUMNS}`;

export const REVISION_GET_SQL = `SELECT ${COLUMNS} FROM artifact_revision WHERE id = $1 AND user_id = $2`;

export const REVISION_LATEST_SQL = `SELECT ${COLUMNS} FROM artifact_revision
  WHERE artifact_id = $1 AND user_id = $2
  ORDER BY revision_number DESC LIMIT 1`;

export const REVISION_LIST_SQL = `SELECT ${COLUMNS} FROM artifact_revision
  WHERE user_id = $1
  ORDER BY created_at DESC, revision_number DESC
  LIMIT $2`;

/** The artifact must be the person's own (read AS them, so a foreign one is simply not there). */
export const REVISION_ARTIFACT_OWNED_SQL = `SELECT id FROM refinery_artifact WHERE id = $1 AND user_id = $2`;

/**
 * Keep at most REVISION_KEEP_PER_ARTIFACT revisions per artifact: the newest
 * ones, and ALWAYS the newest finished one (it is left out of the ordered list,
 * which keeps the newest 49 besides it). The newest revision is first in the
 * list, so it is never pruned either.
 */
export const REVISION_PRUNE_SQL = `DELETE FROM artifact_revision
  WHERE artifact_id = $1 AND user_id = $2 AND id IN (
    SELECT r.id FROM artifact_revision r
     WHERE r.artifact_id = $1 AND r.user_id = $2
       AND r.id IS DISTINCT FROM (
         SELECT f.id FROM artifact_revision f
          WHERE f.artifact_id = $1 AND f.user_id = $2 AND f.status = 'finished'
          ORDER BY f.revision_number DESC LIMIT 1)
     ORDER BY r.revision_number DESC
     OFFSET $3)
  RETURNING id`;

export const REVISION_DELETE_ALL_SQL = `DELETE FROM artifact_revision WHERE user_id = $1 RETURNING id`;

function paramsFor(userId: string, r: NewRevision, hash: string): unknown[] {
  return [
    userId,
    r.artifactId,
    r.source,
    r.docKind,
    r.resumeText,
    r.letterText,
    JSON.stringify(r.keptTerms),
    JSON.stringify(r.confirmedCredentials),
    JSON.stringify(r.defendAnswers),
    JSON.stringify(r.evidence),
    r.checkerVersion,
    r.status,
    r.pageCount,
    r.pageLimit,
    r.lengthChoice,
    JSON.stringify(r.openItems),
    hash,
  ];
}

export type InsertRevisionResult =
  | { status: "saved"; revision: ArtifactRevision; reused: boolean }
  | { status: "not_ready" }
  | { status: "invalid"; reason: string };

/**
 * Save a revision AS its owner. Same content as the artifact's newest
 * revision: that revision comes back (reused: true) and nothing is written.
 */
export async function insertRevision(userId: string, r: NewRevision): Promise<InsertRevisionResult> {
  if (!UUID_RE.test(userId)) return { status: "invalid", reason: "bad user id" };
  const problem = revisionProblem(r);
  if (problem) return { status: "invalid", reason: problem };
  const hash = revisionContentHash(r);
  try {
    // Someone else's artifact is not visible to this person (row-level
    // security), so it reads as missing. Without this check the insert could
    // meet another person's revision number first and quietly do nothing.
    const owned = await getOneAsUser<{ id: string }>(userId, REVISION_ARTIFACT_OWNED_SQL, [r.artifactId, userId]);
    if (!owned) return { status: "invalid", reason: "artifact not found" };
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = await queryAsUser<ArtifactRevision>(userId, REVISION_INSERT_SQL, paramsFor(userId, r, hash));
      if (rows[0]) {
        await pruneRevisions(userId, r.artifactId);
        return { status: "saved", revision: rows[0], reused: false };
      }
      const newest = await getOneAsUser<ArtifactRevision>(userId, REVISION_LATEST_SQL, [r.artifactId, userId]);
      if (newest && newest.content_hash === hash) return { status: "saved", revision: newest, reused: true };
      // A concurrent save took the number; go again.
    }
    return { status: "invalid", reason: "could not assign a revision number" };
  } catch (e) {
    if (revisionTableMissing(e)) return { status: "not_ready" };
    // 23503: the artifact is not this person's (composite foreign key).
    if ((e as { code?: string } | null)?.code === "23503") return { status: "invalid", reason: "artifact not found" };
    throw e;
  }
}

/** Prune an artifact's oldest revisions past the keep count (never the newest, never the newest finished). */
export async function pruneRevisions(userId: string, artifactId: string): Promise<number> {
  const rows = await queryAsUser<{ id: string }>(userId, REVISION_PRUNE_SQL, [artifactId, userId, REVISION_KEEP_PER_ARTIFACT - 1]);
  return rows.length;
}

/** One revision, only the owner's. Null when missing, foreign, malformed, or 081 is not applied. */
export async function getRevision(userId: string, revisionId: string): Promise<ArtifactRevision | null> {
  if (!UUID_RE.test(userId) || typeof revisionId !== "string" || !UUID_RE.test(revisionId)) return null;
  try {
    return await getOneAsUser<ArtifactRevision>(userId, REVISION_GET_SQL, [revisionId, userId]);
  } catch (e) {
    if (revisionTableMissing(e)) return null;
    throw e;
  }
}

/** The newest revision of one artifact, only the owner's. */
export async function getLatestRevision(userId: string, artifactId: string): Promise<ArtifactRevision | null> {
  if (!UUID_RE.test(userId) || typeof artifactId !== "string" || !UUID_RE.test(artifactId)) return null;
  try {
    return await getOneAsUser<ArtifactRevision>(userId, REVISION_LATEST_SQL, [artifactId, userId]);
  } catch (e) {
    if (revisionTableMissing(e)) return null;
    throw e;
  }
}

/** Every revision the person holds, newest first (the data export). */
export async function exportRevisions(userId: string, limit = 5000): Promise<ArtifactRevision[]> {
  if (!UUID_RE.test(userId)) return [];
  try {
    return await queryAsUser<ArtifactRevision>(userId, REVISION_LIST_SQL, [userId, limit]);
  } catch (e) {
    if (revisionTableMissing(e)) return [];
    throw e;
  }
}

/** "Delete my data": every revision the person holds, deleted AS them. Returns how many. */
export async function deleteAllRevisions(userId: string): Promise<number> {
  try {
    const rows = await queryAsUser<{ id: string }>(userId, REVISION_DELETE_ALL_SQL, [userId]);
    return rows.length;
  } catch (e) {
    if (revisionTableMissing(e)) return 0;
    throw e;
  }
}

/** The fields a page may see (never user_id). */
export function publicRevision(r: ArtifactRevision) {
  return {
    id: r.id,
    artifactId: r.artifact_id,
    number: r.revision_number,
    source: r.source,
    docKind: r.doc_kind,
    status: r.status,
    pageCount: r.page_count,
    pageLimit: r.page_limit,
    lengthChoice: r.length_choice,
    openItems: Array.isArray(r.open_items) ? r.open_items : [],
    resumeText: r.resume_text,
    letterText: r.letter_text,
    keptTerms: r.kept_terms,
    confirmedCredentials: r.confirmed_credentials,
    defendAnswers: r.defend_answers,
    evidence: r.evidence,
    checkerVersion: r.checker_version,
    contentHash: r.content_hash,
    createdAt: r.created_at,
  };
}
export type PublicRevision = ReturnType<typeof publicRevision>;

/*
 * The newest writer's receipt per (person, Forge run) (081, review M-B):
 * nonce and time only. generate-docs records it; a save accepts only that one.
 */
export const WRITER_RECEIPT_RECORD_SQL = `INSERT INTO forge_writer_receipt (user_id, run_id, nonce, issued_at)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (user_id, run_id) DO UPDATE SET nonce = EXCLUDED.nonce, issued_at = EXCLUDED.issued_at
   WHERE forge_writer_receipt.issued_at <= EXCLUDED.issued_at`;
export const WRITER_RECEIPT_NEWEST_SQL = `SELECT nonce FROM forge_writer_receipt WHERE user_id = $1 AND run_id = $2`;
export const WRITER_RECEIPT_DELETE_ALL_SQL = `DELETE FROM forge_writer_receipt WHERE user_id = $1 RETURNING run_id`;
/** forge_session is not row-level protected; scoped by user_id in the statement. */
export const RUN_BELONGS_SQL = `SELECT 1 AS ok FROM forge_session WHERE user_id = $1 AND session_id = $2`;

const NONCE_RE = /^[0-9a-f]{32}$/;

export async function recordWriterReceipt(userId: string, runId: string, nonce: string, issuedAtMs: number): Promise<void> {
  if (!UUID_RE.test(userId) || !runId || runId.length > 100 || !NONCE_RE.test(nonce)) return;
  try {
    await queryAsUser(userId, WRITER_RECEIPT_RECORD_SQL, [userId, runId, nonce, new Date(issuedAtMs).toISOString()]);
  } catch (e) {
    if (!revisionTableMissing(e)) throw e;
  }
}

/** The newest recorded nonce for the person's run, or null (none recorded, or 081 not applied). */
export async function newestWriterReceiptNonce(userId: string, runId: string): Promise<string | null> {
  if (!UUID_RE.test(userId) || !runId || runId.length > 100) return null;
  try {
    const row = await getOneAsUser<{ nonce: string }>(userId, WRITER_RECEIPT_NEWEST_SQL, [userId, runId]);
    return row?.nonce ?? null;
  } catch (e) {
    if (revisionTableMissing(e)) return null;
    throw e;
  }
}

export async function deleteAllWriterReceipts(userId: string): Promise<number> {
  try {
    return (await queryAsUser<{ run_id: string }>(userId, WRITER_RECEIPT_DELETE_ALL_SQL, [userId])).length;
  } catch (e) {
    if (revisionTableMissing(e)) return 0;
    throw e;
  }
}

/** Is this Forge run (forge_session.session_id) the person's own? */
export async function runBelongsTo(userId: string, runId: string): Promise<boolean> {
  if (!UUID_RE.test(userId) || !runId || runId.length > 200) return false;
  const row = await getOne<{ ok: number }>(RUN_BELONGS_SQL, [userId, runId]);
  return !!row;
}
