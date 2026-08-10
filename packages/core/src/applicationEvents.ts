/**
 * Application Events + Document Snapshots
 *
 * Phase 1A: the two ledgers that back the immutable-revision model for job
 * applications.
 *
 * application_status_event is an append-only history of job_application.status
 * transitions. job_application.status stays the current-state column; this
 * table is how it got there, and is the source of truth for "how many
 * applications did this user actually send" (countApplicationsSent) rather
 * than inferring it from the current status alone.
 *
 * application_document is an immutable "what did I actually send" snapshot,
 * taken at the moment a document is attached to an application. It survives
 * whatever happens to the source artifact afterward (fork, edit, delete).
 */

import { query, getOne, insert } from "./db";
import { hashContent } from "./refineryArtifact";

export interface ApplicationStatusEvent {
  id: string;
  application_id: string;
  user_id: string;
  from_status: string | null;
  to_status: string;
  created_at: string;
}

/** Append one status transition to the ledger. Fire-and-forget from the caller's view. */
export async function recordStatusEvent(
  userId: string,
  applicationId: string,
  fromStatus: string | null,
  toStatus: string
): Promise<void> {
  await insert("application_status_event", {
    application_id: applicationId,
    user_id: userId,
    from_status: fromStatus,
    to_status: toStatus,
  });
}

/**
 * Count of distinct applications this user has moved to 'applied' at least
 * once. Reads the ledger, not job_application.status, so an application that
 * was applied and later moved on (interviewing, offered, ...) still counts.
 */
export async function countApplicationsSent(userId: string): Promise<number> {
  const row = await getOne<{ count: string }>(
    `SELECT COUNT(DISTINCT application_id)::text AS count
     FROM application_status_event
     WHERE user_id = $1 AND to_status = 'applied'`,
    [userId]
  );
  return row ? parseInt(row.count, 10) : 0;
}

export type DocumentProvenance = "baseline_as_is" | "fine_tuned" | "tailored";

export interface ApplicationDocument {
  id: string;
  application_id: string;
  user_id: string;
  artifact_id: string | null;
  document_type: "resume" | "cover_letter" | "disclosure_plan";
  provenance: DocumentProvenance;
  content_snapshot: Record<string, unknown>;
  content_hash: string;
  created_at: string;
}

/**
 * Snapshot a document's content at the moment it is attached to an
 * application. Immutable once written -- callers create a new snapshot
 * rather than editing an existing one.
 */
export async function snapshotApplicationDocument(opts: {
  userId: string;
  applicationId: string;
  artifactId: string | null;
  documentType: "resume" | "cover_letter" | "disclosure_plan";
  provenance: DocumentProvenance;
  content: Record<string, unknown>;
}): Promise<ApplicationDocument> {
  const { userId, applicationId, artifactId, documentType, provenance, content } = opts;
  return insert<ApplicationDocument>("application_document", {
    application_id: applicationId,
    user_id: userId,
    artifact_id: artifactId,
    document_type: documentType,
    provenance,
    content_snapshot: JSON.stringify(content),
    content_hash: hashContent(content),
  });
}

/** All document snapshots for one application, newest first. */
export async function listApplicationDocuments(
  userId: string,
  applicationId: string
): Promise<ApplicationDocument[]> {
  return query<ApplicationDocument>(
    `SELECT * FROM application_document
     WHERE user_id = $1 AND application_id = $2
     ORDER BY created_at DESC`,
    [userId, applicationId]
  );
}

/**
 * Whether this application has a resume snapshot that was actually tailored
 * or fine-tuned for it (as opposed to sent as-is). Used to answer "did I
 * customize my resume for this job" without guessing from artifact links.
 */
export async function hasTailoredDocument(
  userId: string,
  applicationId: string
): Promise<boolean> {
  const row = await getOne<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM application_document
       WHERE user_id = $1 AND application_id = $2
         AND document_type = 'resume'
         AND provenance IN ('tailored', 'fine_tuned')
     ) AS exists`,
    [userId, applicationId]
  );
  return !!row?.exists;
}
