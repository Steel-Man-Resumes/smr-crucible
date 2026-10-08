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
 * confirms can never both win. Returns false when it was already imported.
 */
export async function markImported(id: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE tablet_session SET imported_at = now(), imported_by = $2
      WHERE id = $1 AND imported_at IS NULL
      RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}

/** Undo markImported when the save itself failed, so the person can try again. */
export async function unmarkImported(id: string, userId: string): Promise<void> {
  await query(
    `UPDATE tablet_session SET imported_at = NULL, imported_by = NULL WHERE id = $1 AND imported_by = $2`,
    [id, userId]
  );
}

/** Admin: clear a plan's lock and wrong-PIN count, by its code. Returns whether a plan matched. */
export async function clearPinLock(importCode: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE tablet_session SET pin_failures = 0, locked_at = NULL
      WHERE import_code = $1
      RETURNING id`,
    [importCode]
  );
  return rows.length > 0;
}
