/**
 * Saved record checks (decision D11, migration 079). Server only.
 *
 * The record check is a separate, consented step. This module is the ONLY
 * code that reads or writes `record_check_saved`. No prompt builder imports
 * it (a test in apps/consumer enforces that).
 *
 * What a saved check holds (security r1 F2):
 *   state          plain two-letter code
 *   picks_sealed   the picked source ids and question ids, sealed. No text:
 *                  every line is rebuilt from the bank and the list on read.
 *   typed_sealed   the job and the record the person typed, sealed, ONLY if
 *                  they ticked "Keep what I typed". NULL otherwise (default).
 *   created_at
 * The AAD binds each sealed value to its owner, row id and field.
 *
 * Every read and write runs AS the owner (queryAsUser / runAsUser): the table
 * is owner-only under FORCE row-level security.
 */

import { randomUUID } from "crypto";
import { queryAsUser, runAsUser } from "./db";
import { encryptJSON, decryptJSON, type EncryptedPayload } from "./crypto";
import { CONSENT_TEXT_VERSION } from "./consent";

/** The consent layer for this step. Default declined (consentDefaultFor). */
export const RECORD_CHECK_CONSENT_LAYER = "record_check" as const;

/** Most saved checks one person may keep (security r1 F10). */
export const RECORD_CHECK_MAX_SAVED = 50;

export const RECORD_CHECK_STATE_RE = /^[A-Z]{2}$/;

/** Ids only. Lines are rebuilt from the bank and the source list on read. */
export interface RecordCheckPicks {
  v: 2;
  sourceIds: string[];
  questionIds: string[];
  generatedBy: "ai" | "plain";
}

/** Only when the person ticked "Keep what I typed". */
export interface RecordCheckTyped {
  job: string;
  offense: string;
}

export interface SavedRecordCheckSummary {
  id: string;
  state: string;
  keptTyped: boolean;
  createdAt: string;
}

export interface SavedRecordCheck extends SavedRecordCheckSummary {
  picks: RecordCheckPicks;
  typed: RecordCheckTyped | null;
}

interface Row {
  id: string;
  state: string;
  picks_sealed: EncryptedPayload;
  typed_sealed: EncryptedPayload | null;
  created_at: string;
}

/** AAD for one sealed field. Pure and exported so the binding is testable. */
export function recordCheckAad(userId: string, rowId: string, field: "picks" | "typed"): string {
  return `record_check:${userId}:${rowId}:${field}`;
}

// SQL kept as constants so the PGlite suite runs the exact text core sends.
//
// The insert is conditional in ONE statement (security r1 F5, F10): it writes
// only while the person's current yes stands and they are under the cap. FOR
// SHARE on the consent row makes a concurrent revoke wait for this write, so
// its delete then sees the new row; or it makes this write re-check after the
// revoke commits, and write nothing.
export const RECORD_CHECK_INSERT_SQL =
  `INSERT INTO record_check_saved (id, user_id, state, picks_sealed, typed_sealed)
   SELECT $1, $2, $3, $4, $5
    WHERE EXISTS (SELECT 1 FROM consumer_consent c
                   WHERE c.user_id = $2 AND c.consent_layer = 'record_check'
                     AND c.status = 'granted' AND c.consent_text_version = $6
                   FOR SHARE)
      AND (SELECT count(*) FROM record_check_saved s WHERE s.user_id = $2) < $7
   RETURNING id, state, created_at`;
export const RECORD_CHECK_COUNT_SQL = `SELECT count(*)::int AS n FROM record_check_saved WHERE user_id = $1`;
export const RECORD_CHECK_LIST_SQL =
  `SELECT id, state, (typed_sealed IS NOT NULL) AS kept_typed, created_at
     FROM record_check_saved
    WHERE user_id = $1
    ORDER BY created_at DESC`;
export const RECORD_CHECK_GET_SQL =
  `SELECT id, state, picks_sealed, typed_sealed, created_at
     FROM record_check_saved
    WHERE id = $1 AND user_id = $2`;
export const RECORD_CHECK_EXPORT_SQL =
  `SELECT id, state, picks_sealed, typed_sealed, created_at
     FROM record_check_saved
    WHERE user_id = $1
    ORDER BY created_at DESC`;
export const RECORD_CHECK_DELETE_ONE_SQL =
  `DELETE FROM record_check_saved WHERE id = $1 AND user_id = $2 RETURNING id`;
export const RECORD_CHECK_DELETE_ALL_SQL =
  `DELETE FROM record_check_saved WHERE user_id = $1 RETURNING id`;

// Revoke, as one transaction (security r1 F5): the yes is marked revoked with
// its time, every saved check is deleted, and the history row is written.
export const RECORD_CHECK_REVOKE_SQL =
  `INSERT INTO consumer_consent (user_id, consent_layer, status, revoked_at, consent_text_version)
   VALUES ($1, 'record_check', 'revoked', now(), $2)
   ON CONFLICT (user_id, consent_layer)
   DO UPDATE SET status = 'revoked', revoked_at = now()
   RETURNING consent_text_version, revoked_at`;
export const RECORD_CHECK_REVOKE_EVENT_SQL =
  `INSERT INTO consumer_consent_event (user_id, consent_layer, action, text_version, collection_method, context)
   SELECT user_id, 'record_check', 'revoked', consent_text_version, 'record_check_screen', '{}'::jsonb
     FROM consumer_consent WHERE user_id = $1 AND consent_layer = 'record_check'`;

/** Seal one row's fields. Pure (no DB); exported for tests. */
export function sealRecordCheck(
  userId: string,
  rowId: string,
  picks: RecordCheckPicks,
  typed: RecordCheckTyped | null
): { picksSealed: EncryptedPayload; typedSealed: EncryptedPayload | null } {
  return {
    picksSealed: encryptJSON(picks, recordCheckAad(userId, rowId, "picks")),
    typedSealed: typed ? encryptJSON(typed, recordCheckAad(userId, rowId, "typed")) : null,
  };
}

/** Open one row. Throws if it cannot be opened (callers count and skip). */
export function openRecordCheckRow(userId: string, row: Row): SavedRecordCheck {
  const picks = decryptJSON<RecordCheckPicks>(row.picks_sealed, recordCheckAad(userId, row.id, "picks"));
  const typed = row.typed_sealed
    ? decryptJSON<RecordCheckTyped>(row.typed_sealed, recordCheckAad(userId, row.id, "typed"))
    : null;
  return { id: row.id, state: row.state, keptTyped: typed !== null, createdAt: String(row.created_at), picks, typed };
}

export type SaveRecordCheckResult =
  | { ok: true; id: string; state: string; createdAt: string }
  | { ok: false; reason: "no_consent" | "cap" };

/** Save one checklist, only under the current yes and below the cap. */
export async function saveRecordCheck(params: {
  userId: string;
  state: string;
  picks: RecordCheckPicks;
  typed: RecordCheckTyped | null;
  consentVersion: string;
}): Promise<SaveRecordCheckResult> {
  const { userId, state } = params;
  if (!RECORD_CHECK_STATE_RE.test(state)) throw new Error("record check: bad state code");
  const id = randomUUID();
  const sealed = sealRecordCheck(userId, id, params.picks, params.typed);
  const rows = await queryAsUser<{ id: string; state: string; created_at: string }>(userId, RECORD_CHECK_INSERT_SQL, [
    id,
    userId,
    state,
    JSON.stringify(sealed.picksSealed),
    sealed.typedSealed ? JSON.stringify(sealed.typedSealed) : null,
    params.consentVersion,
    RECORD_CHECK_MAX_SAVED,
  ]);
  if (rows[0]) return { ok: true, id: rows[0].id, state: rows[0].state, createdAt: String(rows[0].created_at) };
  const [{ n }] = await queryAsUser<{ n: number }>(userId, RECORD_CHECK_COUNT_SQL, [userId]);
  return { ok: false, reason: n >= RECORD_CHECK_MAX_SAVED ? "cap" : "no_consent" };
}

/** The list view: nothing sealed is opened, so nothing typed is sent. */
export async function listRecordCheckSummaries(userId: string): Promise<SavedRecordCheckSummary[]> {
  const rows = await queryAsUser<{ id: string; state: string; kept_typed: boolean; created_at: string }>(
    userId,
    RECORD_CHECK_LIST_SQL,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, state: r.state, keptTyped: !!r.kept_typed, createdAt: String(r.created_at) }));
}

/** One saved check, opened. "unreadable" when it cannot be opened. */
export async function getRecordCheck(userId: string, id: string): Promise<SavedRecordCheck | null | "unreadable"> {
  const rows = await queryAsUser<Row>(userId, RECORD_CHECK_GET_SQL, [id, userId]);
  if (!rows[0]) return null;
  try {
    return openRecordCheckRow(userId, rows[0]);
  } catch {
    return "unreadable";
  }
}

export async function deleteRecordCheck(userId: string, id: string): Promise<boolean> {
  const rows = await queryAsUser<{ id: string }>(userId, RECORD_CHECK_DELETE_ONE_SQL, [id, userId]);
  return rows.length > 0;
}

/** Delete every saved record check ("delete my data"). */
export async function deleteAllRecordChecks(userId: string): Promise<number> {
  const rows = await queryAsUser<{ id: string }>(userId, RECORD_CHECK_DELETE_ALL_SQL, [userId]);
  return rows.length;
}

/** Take back the yes and delete every saved check, in one transaction. */
export async function revokeRecordCheckConsent(userId: string): Promise<{ deleted: number; revokedAt: string }> {
  const out = await runAsUser<unknown[][]>(userId, (c) => {
    const run = c as unknown as (s: string, p?: unknown[]) => unknown;
    return [
      run(RECORD_CHECK_REVOKE_SQL, [userId, CONSENT_TEXT_VERSION]),
      run(RECORD_CHECK_DELETE_ALL_SQL, [userId]),
      run(RECORD_CHECK_REVOKE_EVENT_SQL, [userId]),
    ];
  });
  const revoked = (out[0] as Array<{ revoked_at: string }>)[0];
  return { deleted: (out[1] as unknown[]).length, revokedAt: String(revoked?.revoked_at ?? "") };
}

/** Export view (data rights): every saved check, no limit. A row that cannot
 *  be opened is counted and skipped, never failing the whole export. */
export async function exportRecordChecks(userId: string): Promise<{ checks: SavedRecordCheck[]; unreadable: number }> {
  const rows = await queryAsUser<Row>(userId, RECORD_CHECK_EXPORT_SQL, [userId]);
  const checks: SavedRecordCheck[] = [];
  let unreadable = 0;
  for (const r of rows) {
    try {
      checks.push(openRecordCheckRow(userId, r));
    } catch {
      unreadable++;
    }
  }
  return { checks, unreadable };
}
