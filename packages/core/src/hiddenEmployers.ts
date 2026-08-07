/**
 * User-hidden employers (N1). A user can hide an employer -- typically a former
 * employer they don't want to see, or one they've ruled out -- and it is filtered
 * out of their job search. Matching uses the same `normalizeEmployerName` key as the
 * fair-chance wire, so a listing matches regardless of punctuation/legal-suffix drift.
 */

import { query, getOne } from "./db";
import { normalizeEmployerName } from "./employer";

export interface HiddenEmployer {
  id: string;
  name_key: string;
  display_name: string;
  reason: string | null;
  created_at: string;
}

/** Hide an employer for a user. Idempotent (upsert on user + normalized name). */
export async function hideEmployer(
  userId: string,
  displayName: string,
  reason?: string | null
): Promise<HiddenEmployer | null> {
  const key = normalizeEmployerName(displayName);
  if (!key) return null;
  const rows = await query<HiddenEmployer>(
    `INSERT INTO user_hidden_employer (user_id, name_key, display_name, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, name_key)
       DO UPDATE SET display_name = EXCLUDED.display_name, reason = EXCLUDED.reason
     RETURNING id, name_key, display_name, reason, created_at`,
    [userId, key, displayName.trim(), reason?.trim() || null]
  );
  return rows[0] ?? null;
}

/** Un-hide by row id (ownership-checked). Returns true if a row was removed. */
export async function unhideEmployer(userId: string, id: string): Promise<boolean> {
  const rows = await query(
    `DELETE FROM user_hidden_employer WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

/** List a user's hidden employers (newest first) for the Settings un-hide list. */
export async function listHiddenEmployers(userId: string): Promise<HiddenEmployer[]> {
  return query<HiddenEmployer>(
    `SELECT id, name_key, display_name, reason, created_at
     FROM user_hidden_employer WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
}

/** The set of normalized hidden-employer keys for a user (for job-search filtering). */
export async function getHiddenEmployerSet(userId: string): Promise<Set<string>> {
  const rows = await query<{ name_key: string }>(
    `SELECT name_key FROM user_hidden_employer WHERE user_id = $1`,
    [userId]
  );
  return new Set(rows.map((r) => r.name_key));
}

/** True if the given company name is hidden for this user (exact normalized match). */
export function isHiddenEmployer(company: string, hidden: Set<string>): boolean {
  const key = normalizeEmployerName(company);
  return key.length > 0 && hidden.has(key);
}

/** Count of hidden employers (cheap, for a Settings badge). */
export async function countHiddenEmployers(userId: string): Promise<number> {
  const row = await getOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_hidden_employer WHERE user_id = $1`,
    [userId]
  );
  return Number(row?.n ?? 0);
}
