/**
 * The finished-package email (migration 078, users.forge_package_email).
 *
 * A finished Forge resume is emailed to the person's own account address,
 * and only once that address is proven by a real proof on record
 * (users.email_proof_source, 078: an email link, a Google sign-in Google
 * verified, or a reset by email). 068's backfill does not count. A typed,
 * unproven address gets nothing: it may not be theirs. The person can turn
 * it off, and each finished version goes out once (forge_package_email_sent).
 * Before 078 is applied the column is missing and the switch reads as on (its
 * default) and cannot be changed yet.
 */

import { getOne, query, queryAsUser } from "./db";

export interface PackageEmailTarget {
  /** The account's address, lower-cased, or null. */
  email: string | null;
  /** True only when a real proof is on record (078 email_proof_source; not 068 alone). */
  proven: boolean;
  /** The person's switch. Default on. */
  on: boolean;
}

/** Postgres "column does not exist": 078 is not applied yet. */
function missingColumn(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42703";
}

export async function getPackageEmailTarget(userId: string): Promise<PackageEmailTarget | null> {
  type Row = { email: string | null; proven: boolean; on?: boolean };
  let row: Row | null;
  try {
    // Proven means a REAL proof on record (078 email_proof_source), not just
    // email_proven_at: 068 backfilled that on every older account, typed
    // addresses included (security review 3a Part 2 r1, M2).
    row = await getOne<Row>(
      `SELECT email,
              (email_proven_at IS NOT NULL AND email_proof_source IS NOT NULL) AS proven,
              forge_package_email AS "on"
         FROM users WHERE id = $1`,
      [userId]
    );
  } catch (e) {
    if (!missingColumn(e)) throw e;
    // 078 not applied: no way to tell a proof from the backfill, so nobody
    // counts as proven for the automatic email yet.
    row = await getOne<Row>(`SELECT email, false AS proven FROM users WHERE id = $1`, [userId]);
  }
  if (!row) return null;
  const email = typeof row.email === "string" && row.email.trim() ? row.email.trim().toLowerCase() : null;
  return { email, proven: row.proven === true, on: row.on !== false };
}

/** Turn the email on or off. False when 078 is not applied yet. */
export async function setPackageEmailPref(userId: string, on: boolean): Promise<boolean> {
  try {
    await query(`UPDATE users SET forge_package_email = $2 WHERE id = $1`, [userId, on]);
    return true;
  } catch (e) {
    if (missingColumn(e)) return false;
    throw e;
  }
}

/** Postgres "relation does not exist": 078 is not applied yet. */
function missingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

/** A finished version: SHA-256 hex of the person's id and the finished text. */
export const PACKAGE_VERSION_RE = /^[0-9a-f]{64}$/;

/**
 * Claim this finished version for its one automatic send, written AS the
 * person (078's policy admits only their own row). true: claimed now, send it;
 * false: it was already sent; null: 078 is not applied yet (the caller falls
 * back to a daily count).
 */
export async function claimPackageEmailVersion(userId: string, version: string): Promise<boolean | null> {
  if (!PACKAGE_VERSION_RE.test(version)) throw new Error("bad package version");
  try {
    const rows = await queryAsUser<{ version: string }>(
      userId,
      `INSERT INTO forge_package_email_sent (user_id, version) VALUES ($1, $2)
       ON CONFLICT (user_id, version) DO NOTHING
       RETURNING version`,
      [userId, version]
    );
    return rows.length > 0;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

/** Give a claim back when the email did not go out, so a later visit can send it. */
export async function releasePackageEmailVersion(userId: string, version: string): Promise<void> {
  try {
    await queryAsUser(userId, `DELETE FROM forge_package_email_sent WHERE user_id = $1 AND version = $2`, [userId, version]);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}
