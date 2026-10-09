/**
 * Tablet session management for The Mini Forge.
 *
 * Handles: import code generation, PIN hashing, DB read/write,
 * and session cookie helpers (set/get in server actions/components).
 */

import bcrypt from "bcryptjs";
import { query, getOne } from "@crucible/core";
import { canonicalTabletId } from "./mini-forge-guard";

export const TABLET_COOKIE = "mf_session";

// No ambiguous chars (0/O, 1/I/l) per spec
const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateImportCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export interface TabletSession {
  id: string;
  import_code: string;
  pin_hash: string;
  forge_intake: Record<string, unknown>;
  forge_output: Record<string, unknown> | null;
  processing_status: string;
  facility_hint: string | null;
  created_at: Date;
  processed_at: Date | null;
  claimed_at: Date | null;
  expires_at: Date;
  /** 078: wrong PINs in total, the lock, and the single-use import. */
  pin_failures?: number;
  locked_at?: Date | null;
  imported_at?: Date | null;
  imported_by?: string | null;
  /** Set once the plan was saved into imported_by's account (r3, R3-1). */
  import_saved_at?: Date | null;
  unlocked_at?: Date | null;
  unlocked_by?: string | null;
}

/** Postgres "column does not exist": 078 is not applied here yet. */
export function tabletColumnsMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42703";
}

export async function createTabletSession(
  pin: string,
  facilityHint?: string
): Promise<TabletSession> {
  const pinHash = await hashPin(pin);

  for (let attempt = 0; attempt < 5; attempt++) {
    const importCode = generateImportCode();
    try {
      const rows = await query<TabletSession>(
        `INSERT INTO tablet_session (import_code, pin_hash, facility_hint)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [importCode, pinHash, facilityHint ?? null]
      );
      return rows[0];
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") continue; // unique violation on import_code -- retry
      throw err;
    }
  }
  throw new Error("Could not generate a unique import code after 5 attempts");
}

export async function getTabletSession(id: string): Promise<TabletSession | null> {
  // Only the canonical spelling (lib/mini-forge-guard.ts): one plan, one id.
  if (!canonicalTabletId(id)) return null;
  return getOne<TabletSession>(
    `SELECT * FROM tablet_session WHERE id = $1 AND expires_at > NOW() AND claimed_at IS NULL`,
    [id]
  );
}

export async function updateIntake(
  id: string,
  intake: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE tablet_session SET forge_intake = $1 WHERE id = $2`,
    [JSON.stringify(intake), id]
  );
}

export async function saveOutput(
  id: string,
  output: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE tablet_session
     SET forge_output = $1, processing_status = 'ready', processed_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(output), id]
  );
}

export async function markClaimed(id: string): Promise<void> {
  await query(
    `UPDATE tablet_session SET processing_status = 'claimed', claimed_at = NOW() WHERE id = $1`,
    [id]
  );
}

/** Optimistic lock: transitions pending → processing. Returns true if this caller won. */
export async function tryClaimProcessing(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE tablet_session SET processing_status = 'processing'
     WHERE id = $1 AND processing_status = 'pending'
     RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

/** Roll back a failed processing claim: processing → pending so a retry can claim it. */
export async function releaseProcessingClaim(id: string): Promise<void> {
  await query(
    `UPDATE tablet_session SET processing_status = 'pending'
     WHERE id = $1 AND processing_status = 'processing'`,
    [id]
  );
}

/**
 * Read a plan for the import confirm step, regardless of claimed_at. The id
 * must already be canonical (lib/mini-forge-guard.ts canonicalTabletId); the
 * row's own id is what callers key their counters on.
 */
export async function getTabletSessionForImport(id: string): Promise<TabletSession | null> {
  if (!canonicalTabletId(id)) return null;
  return getOne<TabletSession>(
    `SELECT * FROM tablet_session WHERE id = $1 AND expires_at > NOW()`,
    [id]
  );
}

/** A plan by its code alone (the PIN is checked by the caller, after the plan-state checks). */
export async function getTabletSessionByCodeOnly(importCode: string): Promise<TabletSession | null> {
  return getOne<TabletSession>(
    `SELECT * FROM tablet_session WHERE import_code = $1 AND expires_at > NOW()`,
    [importCode]
  );
}

/**
 * One wrong PIN, counted on the plan itself. At `lockAfter` in total the plan
 * locks (locked_at) until an admin clears it. Throws when 078 is missing.
 */
export async function recordPinFailure(id: string, lockAfter: number): Promise<{ failures: number; locked: boolean }> {
  const row = await getOne<{ pin_failures: number; locked: boolean }>(
    `UPDATE tablet_session
        SET pin_failures = pin_failures + 1,
            locked_at = CASE WHEN pin_failures + 1 >= $2 THEN COALESCE(locked_at, now()) ELSE locked_at END
      WHERE id = $1
      RETURNING pin_failures, (locked_at IS NOT NULL) AS locked`,
    [id, lockAfter]
  );
  return { failures: row?.pin_failures ?? 0, locked: row?.locked === true };
}

/**
 * Single use: mark the plan imported into this account. Atomic, so two
 * accounts can never both win. The SAME account may claim again, to finish
 * its own import that was cut off between the claim and the save (review r2,
 * N2), or to load the plan again on purpose (r3, I3; the page asks first).
 * Returns null when another account holds it, otherwise whether the claim is
 * FRESH (created from nothing by this call). Only a fresh claim may be given
 * back if the save fails.
 */
export async function markImported(id: string, userId: string): Promise<{ fresh: boolean } | null> {
  const rows = await query<{ fresh: boolean }>(
    `WITH prev AS (SELECT id, imported_at FROM tablet_session WHERE id = $1 FOR UPDATE)
     UPDATE tablet_session t
        SET imported_at = COALESCE(t.imported_at, now()), imported_by = $2
       FROM prev
      WHERE t.id = prev.id AND (t.imported_at IS NULL OR t.imported_by = $2)
      RETURNING (prev.imported_at IS NULL) AS fresh`,
    [id, userId]
  );
  return rows[0] ? { fresh: rows[0].fresh === true } : null;
}

/** The plan is now saved into the importer's account: the claim is final (r3, R3-1). */
export async function markImportSaved(id: string, userId: string): Promise<void> {
  await query(`UPDATE tablet_session SET import_saved_at = now() WHERE id = $1 AND imported_by = $2`, [id, userId]);
}

/**
 * Undo a FRESH markImported when its save failed, so the person can try
 * again. Never touches a claim whose plan was saved (import_saved_at), and
 * only the importer's own.
 */
export async function unmarkImported(id: string, userId: string): Promise<void> {
  await query(
    `UPDATE tablet_session SET imported_at = NULL, imported_by = NULL
      WHERE id = $1 AND imported_by = $2 AND import_saved_at IS NULL`,
    [id, userId]
  );
}

/**
 * "Delete my data" and account deletion: every plan this person imported is
 * expired and emptied, so it can never be loaded again, by anyone (r3,
 * R3-1). The purge job then removes the rows.
 */
export async function expireImportedPlans(userId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE tablet_session
        SET expires_at = now(), forge_output = NULL, forge_intake = '{}'::jsonb
      WHERE imported_by = $1
      RETURNING id`,
    [userId]
  );
  return rows.length;
}

/** How old an import claim with nothing saved must be before an admin may release it. */
export const STUCK_CLAIM_MINUTES = 15;

/**
 * Admin: open a plan again, by its code. Clears the wrong-PIN count and the
 * lock, records who did it and when (unlocked_at, unlocked_by), and releases
 * an import claim that is older than STUCK_CLAIM_MINUTES with no plan saved
 * under it (security review 3a Part 2 r2, N2): a claim whose save never ran.
 * A finished import is never released: not when import_saved_at is set (r3,
 * R3-1), not when its forge_session row exists, and not when the importer's
 * account is gone (imported_by NULL).
 */
export async function clearPinLock(
  importCode: string,
  adminId: string
): Promise<{ found: boolean; claimReleased: boolean }> {
  const rows = await query<{ id: string; released: boolean }>(
    `WITH target AS (
       SELECT t.id,
              (t.imported_at IS NOT NULL
               AND t.imported_by IS NOT NULL
               AND t.import_saved_at IS NULL
               AND t.imported_at < now() - make_interval(mins => $3::int)
               AND NOT EXISTS (SELECT 1 FROM forge_session fs WHERE fs.session_id = 'mini-forge-' || t.id::text)) AS stuck
         FROM tablet_session t
        WHERE t.import_code = $1
     )
     UPDATE tablet_session t
        SET pin_failures = 0, locked_at = NULL, unlocked_at = now(), unlocked_by = $2,
            imported_at = CASE WHEN target.stuck THEN NULL ELSE t.imported_at END,
            imported_by = CASE WHEN target.stuck THEN NULL ELSE t.imported_by END
       FROM target
      WHERE t.id = target.id
      RETURNING t.id, target.stuck AS released`,
    [importCode, adminId, STUCK_CLAIM_MINUTES]
  );
  return { found: rows.length > 0, claimReleased: rows[0]?.released === true };
}
