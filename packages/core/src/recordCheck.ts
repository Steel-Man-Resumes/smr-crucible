/**
 * Saved record checks (decision D11, migration 079). Server only.
 *
 * The record check is a separate, consented step: the person types an offense
 * the way they choose, their state, and the job or license they want, and gets
 * a checklist of official sources to check and questions to ask. This module
 * is the ONLY code that reads or writes `record_check_saved`. No prompt
 * builder imports it (a test in apps/consumer enforces that), so nothing saved
 * here can reach the writer, t.ROY chat, interview practice or the tailor.
 *
 * What is stored, and only when the person presses "Save this checklist":
 *   state            plain two-letter code ('US' for federal only)
 *   checklist_sealed the job they typed + the checklist, sealed (AES-256-GCM)
 *   offense_sealed   the offense they typed, sealed, ONLY if they ticked
 *                    "keep what I typed". NULL otherwise (the default).
 * The AAD binds each sealed value to its owner, row id and field, so a sealed
 * value copied into another row or another person's row fails to open.
 *
 * Every read and write runs AS the owner (queryAsUser): the table is owner-only
 * under FORCE row-level security, and an unscoped query would see nothing.
 */

import { randomUUID } from "crypto";
import { queryAsUser } from "./db";
import { encryptJSON, decryptJSON, encryptString, decryptString, type EncryptedPayload } from "./crypto";

/** The consent layer for this step. Default declined (consentDefaultFor). */
export const RECORD_CHECK_CONSENT_LAYER = "record_check" as const;

/** One row's owner-visible content, after opening. */
export interface RecordCheckSealedContent {
  job: string;
  /** The checklist as the server built it (source ids, steps, questions). */
  checklist: unknown;
}

export interface SavedRecordCheck {
  id: string;
  state: string;
  job: string;
  checklist: unknown;
  /** Present only when the person chose to keep what they typed. */
  offense: string | null;
  createdAt: string;
}

export interface SavedRecordCheckSummary {
  id: string;
  state: string;
  job: string;
  keptOffense: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  state: string;
  checklist_sealed: EncryptedPayload;
  offense_sealed: EncryptedPayload | null;
  created_at: string;
}

/** AAD for one sealed field. Pure and exported so the binding is testable. */
export function recordCheckAad(userId: string, rowId: string, field: "checklist" | "offense"): string {
  return `record_check:${userId}:${rowId}:${field}`;
}

export const RECORD_CHECK_STATE_RE = /^[A-Z]{2}$/;

// SQL kept as constants so the PGlite suite runs the exact text core sends.
export const RECORD_CHECK_INSERT_SQL =
  `INSERT INTO record_check_saved (id, user_id, state, checklist_sealed, offense_sealed)
   VALUES ($1, $2, $3, $4, $5)
   RETURNING id, state, created_at`;
export const RECORD_CHECK_LIST_SQL =
  `SELECT id, state, checklist_sealed, offense_sealed, created_at
     FROM record_check_saved
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 200`;
export const RECORD_CHECK_DELETE_ONE_SQL =
  `DELETE FROM record_check_saved WHERE id = $1 AND user_id = $2 RETURNING id`;
export const RECORD_CHECK_DELETE_ALL_SQL =
  `DELETE FROM record_check_saved WHERE user_id = $1 RETURNING id`;

/** Seal one row's fields. Pure (no DB); exported for tests. */
export function sealRecordCheck(
  userId: string,
  rowId: string,
  content: RecordCheckSealedContent,
  offense: string | null
): { checklistSealed: EncryptedPayload; offenseSealed: EncryptedPayload | null } {
  return {
    checklistSealed: encryptJSON(content, recordCheckAad(userId, rowId, "checklist")),
    offenseSealed: offense ? encryptString(offense, recordCheckAad(userId, rowId, "offense")) : null,
  };
}

function openRow(userId: string, row: Row): SavedRecordCheck {
  const content = decryptJSON<RecordCheckSealedContent>(row.checklist_sealed, recordCheckAad(userId, row.id, "checklist"));
  const offense = row.offense_sealed
    ? decryptString(row.offense_sealed, recordCheckAad(userId, row.id, "offense"))
    : null;
  return {
    id: row.id,
    state: row.state,
    job: typeof content?.job === "string" ? content.job : "",
    checklist: content?.checklist ?? null,
    offense,
    createdAt: String(row.created_at),
  };
}

/** Save one checklist. `offense` is stored only when the caller passes it,
 *  which the route does only when the person ticked "keep what I typed". */
export async function saveRecordCheck(params: {
  userId: string;
  state: string;
  job: string;
  checklist: unknown;
  offense?: string | null;
}): Promise<{ id: string; state: string; createdAt: string }> {
  const { userId, state } = params;
  if (!RECORD_CHECK_STATE_RE.test(state)) throw new Error("record check: bad state code");
  const id = randomUUID();
  const sealed = sealRecordCheck(userId, id, { job: params.job, checklist: params.checklist }, params.offense ?? null);
  const rows = await queryAsUser<{ id: string; state: string; created_at: string }>(userId, RECORD_CHECK_INSERT_SQL, [
    id,
    userId,
    state,
    JSON.stringify(sealed.checklistSealed),
    sealed.offenseSealed ? JSON.stringify(sealed.offenseSealed) : null,
  ]);
  const r = rows[0];
  if (!r) throw new Error("record check: save returned no row");
  return { id: r.id, state: r.state, createdAt: String(r.created_at) };
}

/** The owner's saved checklists, opened. Never includes the offense unless kept. */
export async function listRecordChecks(userId: string): Promise<SavedRecordCheck[]> {
  const rows = await queryAsUser<Row>(userId, RECORD_CHECK_LIST_SQL, [userId]);
  return rows.map((r) => openRow(userId, r));
}

/** List view: no checklist body, no offense, just whether one was kept. */
export async function listRecordCheckSummaries(userId: string): Promise<SavedRecordCheckSummary[]> {
  return (await listRecordChecks(userId)).map((r) => ({
    id: r.id,
    state: r.state,
    job: r.job,
    keptOffense: r.offense !== null,
    createdAt: r.createdAt,
  }));
}

export async function deleteRecordCheck(userId: string, id: string): Promise<boolean> {
  const rows = await queryAsUser<{ id: string }>(userId, RECORD_CHECK_DELETE_ONE_SQL, [id, userId]);
  return rows.length > 0;
}

/** Delete every saved record check (revoking consent, and "delete my data"). */
export async function deleteAllRecordChecks(userId: string): Promise<number> {
  const rows = await queryAsUser<{ id: string }>(userId, RECORD_CHECK_DELETE_ALL_SQL, [userId]);
  return rows.length;
}

/** Export view (data rights): every saved check, opened, offense included only if kept. */
export async function exportRecordChecks(userId: string): Promise<SavedRecordCheck[]> {
  return listRecordChecks(userId);
}
