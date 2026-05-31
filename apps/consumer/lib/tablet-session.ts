/**
 * Tablet session management for The Mini Forge.
 *
 * Handles: import code generation, PIN hashing, DB read/write,
 * and session cookie helpers (set/get in server actions/components).
 */

import bcrypt from "bcryptjs";
import { query, getOne } from "@crucible/core";

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
  return getOne<TabletSession>(
    `SELECT * FROM tablet_session WHERE id = $1 AND expires_at > NOW() AND claimed_at IS NULL`,
    [id]
  );
}

export async function getTabletSessionByCode(
  importCode: string,
  pin: string
): Promise<TabletSession | null> {
  const session = await getOne<TabletSession>(
    `SELECT * FROM tablet_session WHERE import_code = $1 AND expires_at > NOW()`,
    [importCode.toUpperCase().trim()]
  );
  if (!session) return null;
  const valid = await verifyPin(pin, session.pin_hash);
  return valid ? session : null;
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
