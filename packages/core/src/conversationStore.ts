/**
 * Phase 5.1: encrypted, TEXT-ONLY conversation store.
 *
 * The foundation for disclosure rehearsal (5.5) and interview voice transcripts
 * (5.6-5.8). Everything those surfaces persist flows through here.
 *
 * DOCTRINE (locked, mirror migration 041):
 *   * TEXT ONLY. Audio never touches this module. A "chunk" is one turn of
 *     text (the user's line or the assistant's line).
 *   * Encrypted at rest with app-level AES-256-GCM (crypto.ts), NOT R2. Each
 *     chunk's text is encrypted before it is written; the row stores only
 *     ciphertext + iv + auth_tag + key_version. A read decrypts in-process and
 *     never hands back a link to plaintext.
 *   * AAD binding: every chunk is bound to `${ownerUserId}:${purpose}:${sessionId}`
 *     (see buildConversationAad -- this mirrors secureObject.ts's owner:purpose[:extra]
 *     shape). Decrypt fails closed if any of the three don't match, so a stored
 *     ciphertext can never be replayed under a different owner, purpose, or
 *     session.
 *   * Per-purpose SEPARATION: disclosure and interview have their OWN tables
 *     (CONVERSATION_TABLES). This module is generic over purpose, but the table
 *     names are per-purpose -- purpose/retention/derived-data differ, so the
 *     stores stay apart.
 *   * IDEMPOTENT appends: appendConversationChunk does INSERT ... ON CONFLICT
 *     (session_id, seq) DO NOTHING. A client retry of the same turn is a no-op,
 *     never a dupe. Per-turn capture (not end-only) means a crash loses at most
 *     the last turn.
 *   * OWNER-EXCLUSIVE: every function is scoped to ownerUserId and verifies
 *     ownership before touching a chunk. There is no admin/org bypass by design
 *     (same posture as secureObject.ts).
 *
 * Consent: the CALLER checks isConsentGranted(userId, consentLayerForPurpose(purpose))
 * BEFORE calling createConversationSession/appendConversationChunk. This module
 * does not re-check consent -- it stores what it is told to store. The gate
 * lives in the route so a "no consent" run can continue WITHOUT persistence.
 */

import { query, getOne } from "./db";
import { encryptString, decryptString, EncryptedPayload } from "./crypto";
import type { ConsentLayer } from "./consent";

export type ConversationPurpose = "disclosure_rehearsal" | "interview_voice";

export const CONVERSATION_PURPOSES: readonly ConversationPurpose[] = [
  "disclosure_rehearsal",
  "interview_voice",
];

export type ConversationRole = "user" | "assistant";

/** Per-purpose table names. Generic code, per-purpose storage -- see doctrine. */
export const CONVERSATION_TABLES: Record<
  ConversationPurpose,
  { session: string; chunk: string }
> = {
  disclosure_rehearsal: {
    session: "disclosure_rehearsal_session",
    chunk: "disclosure_rehearsal_chunk",
  },
  interview_voice: {
    session: "interview_voice_session",
    chunk: "interview_voice_chunk",
  },
};

/** The consent layer that gates persistence for each purpose. The caller checks
 *  isConsentGranted(userId, consentLayerForPurpose(purpose)) before persisting. */
export function consentLayerForPurpose(purpose: ConversationPurpose): ConsentLayer {
  return purpose === "disclosure_rehearsal"
    ? "disclosure_transcript"
    : "interview_transcript";
}

/** Type guard for an untrusted purpose value off the wire. */
export function isConversationPurpose(x: unknown): x is ConversationPurpose {
  return x === "disclosure_rehearsal" || x === "interview_voice";
}

/** Type guard for an untrusted role value off the wire. */
export function isConversationRole(x: unknown): x is ConversationRole {
  return x === "user" || x === "assistant";
}

/**
 * The AAD every chunk is encrypted under. Pure and exported so the binding
 * format is testable without a DB. Mirrors secureObject.ts's
 * `${owner}:${purpose}:${extra}` shape, with the session id as the extra.
 */
export function buildConversationAad(
  ownerUserId: string,
  purpose: ConversationPurpose,
  sessionId: string
): string {
  return `${ownerUserId}:${purpose}:${sessionId}`;
}

export interface ConversationSessionMeta {
  id: string;
  owner_user_id: string;
  target_context: Record<string, unknown>;
  consent_layer: string;
  status: "active" | "ended";
  struggle_tags: string[];
  takeaways: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
}

interface ConversationChunkRow {
  seq: number;
  role: ConversationRole;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: string;
}

export interface DecryptedChunk {
  seq: number;
  role: ConversationRole;
  text: string;
}

/**
 * Create a new conversation session and return its id.
 *
 * Consent is the CALLER's responsibility -- check
 * isConsentGranted(ownerUserId, consentLayerForPurpose(purpose)) first. The
 * consentLayer passed here is stamped onto the row for the record; it does not
 * gate anything at this layer.
 */
export async function createConversationSession(params: {
  ownerUserId: string;
  purpose: ConversationPurpose;
  targetContext?: Record<string, unknown>;
  consentLayer: string;
}): Promise<string> {
  const { ownerUserId, purpose, targetContext, consentLayer } = params;
  const { session } = CONVERSATION_TABLES[purpose];
  const row = await getOne<{ id: string }>(
    `INSERT INTO ${session} (owner_user_id, target_context, consent_layer)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [ownerUserId, JSON.stringify(targetContext ?? {}), consentLayer]
  );
  if (!row) throw new Error("Failed to create conversation session");
  return row.id;
}

/** Confirm a session exists AND belongs to this owner. Owner-exclusive gate
 *  reused by append/end/detail before any read or write. */
async function assertSessionOwned(
  ownerUserId: string,
  purpose: ConversationPurpose,
  sessionId: string
): Promise<boolean> {
  const { session } = CONVERSATION_TABLES[purpose];
  const row = await getOne<{ id: string }>(
    `SELECT id FROM ${session} WHERE id = $1 AND owner_user_id = $2`,
    [sessionId, ownerUserId]
  );
  return !!row;
}

/**
 * Append one text turn to a session. Idempotent on (session_id, seq): a retry
 * of the same seq is a no-op, never a duplicate. Verifies ownership first, then
 * encrypts the text under the owner:purpose:session AAD and inserts.
 *
 * Throws if the session is not owned by ownerUserId or the text is empty.
 */
export async function appendConversationChunk(params: {
  ownerUserId: string;
  purpose: ConversationPurpose;
  sessionId: string;
  seq: number;
  role: ConversationRole;
  text: string;
}): Promise<void> {
  const { ownerUserId, purpose, sessionId, seq, role, text } = params;

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) throw new Error("Cannot store an empty conversation chunk");

  const owned = await assertSessionOwned(ownerUserId, purpose, sessionId);
  if (!owned) throw new Error("Conversation session not found");

  const { chunk } = CONVERSATION_TABLES[purpose];
  const aad = buildConversationAad(ownerUserId, purpose, sessionId);
  const enc: EncryptedPayload = encryptString(text, aad);

  await query(
    `INSERT INTO ${chunk}
       (session_id, owner_user_id, seq, role, ciphertext, iv, auth_tag, key_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (session_id, seq) DO NOTHING`,
    [
      sessionId,
      ownerUserId,
      seq,
      role,
      enc.ciphertext,
      enc.iv,
      enc.tag,
      enc.keyVersion,
    ]
  );
}

/**
 * Mark a session ended. Owner-scoped -- a foreign session id is a no-op. Only
 * moves 'active' -> 'ended' so a re-end is harmless. Optional struggle_tags and
 * takeaways are non-sensitive derived metadata (never the transcript).
 */
export async function endConversationSession(params: {
  ownerUserId: string;
  purpose: ConversationPurpose;
  sessionId: string;
  struggleTags?: string[];
  takeaways?: Record<string, unknown> | null;
}): Promise<void> {
  const { ownerUserId, purpose, sessionId, struggleTags, takeaways } = params;
  const { session } = CONVERSATION_TABLES[purpose];
  await query(
    `UPDATE ${session}
       SET status = 'ended',
           ended_at = now(),
           struggle_tags = COALESCE($3, struggle_tags),
           takeaways = COALESCE($4, takeaways)
     WHERE id = $1 AND owner_user_id = $2 AND status = 'active'`,
    [
      sessionId,
      ownerUserId,
      struggleTags ?? null,
      takeaways === undefined ? null : JSON.stringify(takeaways),
    ]
  );
}

/**
 * List a user's sessions for one purpose -- METADATA ONLY, newest first. No
 * decrypted content: the list view shows framing and status, never transcript.
 */
export async function listConversationSessions(
  ownerUserId: string,
  purpose: ConversationPurpose
): Promise<ConversationSessionMeta[]> {
  const { session } = CONVERSATION_TABLES[purpose];
  return query<ConversationSessionMeta>(
    `SELECT id, owner_user_id, target_context, consent_layer, status,
            struggle_tags, takeaways, started_at, ended_at
       FROM ${session}
      WHERE owner_user_id = $1
      ORDER BY started_at DESC`,
    [ownerUserId]
  );
}

/**
 * Full ordered, DECRYPTED transcript for one session. Owner-checked. Powers the
 * session-history detail view and the export path. Each chunk is decrypted with
 * the same owner:purpose:session AAD it was encrypted under. Returns null if the
 * session is not found or not owned by ownerUserId.
 */
export async function getConversationTranscript(params: {
  ownerUserId: string;
  purpose: ConversationPurpose;
  sessionId: string;
}): Promise<DecryptedChunk[] | null> {
  const { ownerUserId, purpose, sessionId } = params;

  const owned = await assertSessionOwned(ownerUserId, purpose, sessionId);
  if (!owned) return null;

  const { chunk } = CONVERSATION_TABLES[purpose];
  const rows = await query<ConversationChunkRow>(
    `SELECT seq, role, ciphertext, iv, auth_tag, key_version
       FROM ${chunk}
      WHERE session_id = $1 AND owner_user_id = $2
      ORDER BY seq ASC`,
    [sessionId, ownerUserId]
  );

  const aad = buildConversationAad(ownerUserId, purpose, sessionId);
  return rows.map((r) => ({
    seq: r.seq,
    role: r.role,
    text: decryptString(
      {
        ciphertext: r.ciphertext,
        iv: r.iv,
        tag: r.auth_tag,
        keyVersion: r.key_version,
      },
      aad
    ),
  }));
}

/**
 * Delete ALL of a user's conversation data across BOTH purposes -- for
 * delete-data. Chunks cascade off their session, but each session table is
 * deleted explicitly (scoped to owner_user_id) so this is safe to retry over
 * neon-http's no-transaction driver, same as delete-data's other steps.
 */
export async function deleteUserConversations(ownerUserId: string): Promise<void> {
  for (const purpose of CONVERSATION_PURPOSES) {
    const { session } = CONVERSATION_TABLES[purpose];
    await query(`DELETE FROM ${session} WHERE owner_user_id = $1`, [ownerUserId]);
  }
}

export interface ExportedConversationSession {
  purpose: ConversationPurpose;
  session: ConversationSessionMeta;
  transcript: DecryptedChunk[];
}

/**
 * Every conversation the user has, DECRYPTED and grouped by purpose+session --
 * for export-data. This is the only "give me everything" read; it walks each
 * purpose, lists the sessions, and decrypts each transcript in owner scope.
 */
export async function exportUserConversations(
  ownerUserId: string
): Promise<ExportedConversationSession[]> {
  const out: ExportedConversationSession[] = [];
  for (const purpose of CONVERSATION_PURPOSES) {
    const sessions = await listConversationSessions(ownerUserId, purpose);
    for (const session of sessions) {
      const transcript =
        (await getConversationTranscript({
          ownerUserId,
          purpose,
          sessionId: session.id,
        })) ?? [];
      out.push({ purpose, session, transcript });
    }
  }
  return out;
}
