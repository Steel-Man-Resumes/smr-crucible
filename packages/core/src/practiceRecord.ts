/**
 * The practice record: the database half. Every statement runs AS the person
 * (queryAsUser), so the owner-only policies on practice_entry (migration 075)
 * decide what is visible; the WHERE user_id clauses are a second, explicit
 * layer, never the only one.
 *
 * The SQL lives in exported constants so the scratch-database test can run
 * the exact statements against the real schema.
 */

import { queryAsUser, getOneAsUser } from "./db";
import {
  MAX_PRACTICE_ENTRIES,
  resolvePracticeEntry,
  type PracticeEntry,
  type PracticeEntryInput,
  type PracticeEntryError,
} from "./practiceRecordShared";

export * from "./practiceRecordShared";

const ENTRY_COLUMNS = `id, user_id, section, title, venue, city, state, year, end_year, details, proof,
  names_facility, created_at, updated_at`;

export const PRACTICE_LIST_SQL = `SELECT ${ENTRY_COLUMNS} FROM practice_entry
  WHERE user_id = $1
  ORDER BY section, year DESC, end_year DESC NULLS LAST, created_at`;

export const PRACTICE_GET_SQL = `SELECT ${ENTRY_COLUMNS} FROM practice_entry WHERE id = $1 AND user_id = $2`;

export const PRACTICE_COUNT_SQL = `SELECT COUNT(*)::int AS n FROM practice_entry WHERE user_id = $1`;

export const PRACTICE_INSERT_SQL = `INSERT INTO practice_entry
  (user_id, section, title, venue, city, state, year, end_year, details, proof, names_facility)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
  RETURNING ${ENTRY_COLUMNS}`;

export const PRACTICE_UPDATE_SQL = `UPDATE practice_entry
  SET title = $3, venue = $4, city = $5, state = $6, year = $7, end_year = $8,
      details = $9::jsonb, proof = $10, names_facility = $11, updated_at = now()
  WHERE id = $1 AND user_id = $2
  RETURNING ${ENTRY_COLUMNS}`;

/** The person's own entry; removing it is their call (it is their record). */
export const PRACTICE_DELETE_SQL = `DELETE FROM practice_entry WHERE id = $1 AND user_id = $2 RETURNING id`;

export async function listPracticeEntries(userId: string): Promise<PracticeEntry[]> {
  return queryAsUser<PracticeEntry>(userId, PRACTICE_LIST_SQL, [userId]);
}

export async function getPracticeEntry(userId: string, entryId: string): Promise<PracticeEntry | null> {
  return getOneAsUser<PracticeEntry>(userId, PRACTICE_GET_SQL, [entryId, userId]);
}

export type PracticeWriteResult =
  | { status: "ok"; entry: PracticeEntry }
  | { status: "invalid"; error: PracticeEntryError }
  | { status: "too_many" }
  | { status: "not_found" };

export async function createPracticeEntry(userId: string, input: PracticeEntryInput): Promise<PracticeWriteResult> {
  const r = resolvePracticeEntry(input, null);
  if (!r.ok) return { status: "invalid", error: r.error };
  const count = await getOneAsUser<{ n: number }>(userId, PRACTICE_COUNT_SQL, [userId]);
  if ((count?.n ?? 0) >= MAX_PRACTICE_ENTRIES) return { status: "too_many" };
  const v = r.value;
  const rows = await queryAsUser<PracticeEntry>(userId, PRACTICE_INSERT_SQL, [
    userId, v.section, v.title, v.venue, v.city, v.state, v.year, v.end_year, JSON.stringify(v.details), v.proof, v.names_facility,
  ]);
  return rows[0] ? { status: "ok", entry: rows[0] } : { status: "not_found" };
}

export async function updatePracticeEntry(
  userId: string,
  entryId: string,
  input: PracticeEntryInput
): Promise<PracticeWriteResult> {
  const current = await getPracticeEntry(userId, entryId);
  if (!current) return { status: "not_found" };
  const r = resolvePracticeEntry(input, current);
  if (!r.ok) return { status: "invalid", error: r.error };
  const v = r.value;
  const rows = await queryAsUser<PracticeEntry>(userId, PRACTICE_UPDATE_SQL, [
    entryId, userId, v.title, v.venue, v.city, v.state, v.year, v.end_year, JSON.stringify(v.details), v.proof, v.names_facility,
  ]);
  return rows[0] ? { status: "ok", entry: rows[0] } : { status: "not_found" };
}

export async function deletePracticeEntry(userId: string, entryId: string): Promise<boolean> {
  const rows = await queryAsUser(userId, PRACTICE_DELETE_SQL, [entryId, userId]);
  return rows.length > 0;
}
