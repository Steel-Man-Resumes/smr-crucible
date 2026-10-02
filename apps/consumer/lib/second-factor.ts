/**
 * The one second-factor check (TOTP code or one-time backup code), shared by
 * password sign-in (auth.ts authorize), the step-up after an email link or
 * Google sign-in, and turning two-step off.
 *
 * Node runtime only (bcrypt, Node crypto via two-factor.ts). auth.ts imports it
 * dynamically inside authorize(), never from the Edge middleware.
 *
 * F10 (2026-10-02):
 *  - Replay guard: the time step of the last accepted code is stored
 *    (user_two_factor.last_totp_step, migration 065) and a code for that step
 *    or an earlier one is refused. Without it an observed code worked again for
 *    about 90 seconds.
 *  - Backup codes are only checked when the input looks like one. Every failed
 *    6-digit code used to run up to ten bcrypt compares.
 */
import bcrypt from "bcryptjs";
import type { Db } from "@/lib/session-registry";
import {
  encryptTotpSecret,
  isTotpFormat,
  matchTotpStep,
  normalizeBackupCode,
  resolveTotpSecret,
} from "@/lib/two-factor";

export type SecondFactorResult =
  | { ok: true; method: "totp" | "backup" }
  | { ok: false; reason: "format" | "mismatch" | "replay" | "not-enrolled" };

/** Postgres "undefined_column": the replay-guard column is not migrated yet. */
const UNDEFINED_COLUMN = "42703";

/**
 * Accept `step` for this user only if it is later than the last accepted step.
 * Atomic: two concurrent requests with the same code cannot both pass.
 *
 * If migration 065 has not run yet the column does not exist; the code is then
 * accepted without the guard (the behavior before F10) rather than locking
 * every two-step user out of a deploy that went out ahead of its migration.
 */
export async function consumeTotpStep(db: Db, userId: string, step: number): Promise<boolean> {
  try {
    const r = await db.query(
      `UPDATE user_two_factor SET last_totp_step = $2
        WHERE user_id = $1 AND (last_totp_step IS NULL OR last_totp_step < $2)`,
      [userId, step]
    );
    return (r.rowCount ?? 0) === 1;
  } catch (err: any) {
    if (err?.code === UNDEFINED_COLUMN) {
      console.error("[2fa] last_totp_step missing (migration 065 not applied); replay guard off");
      return true;
    }
    throw err;
  }
}

/**
 * Check a code typed by the user. A successful backup code is consumed; a
 * successful TOTP code advances the replay guard.
 */
export async function verifySecondFactor(
  db: Db,
  userId: string,
  input: string,
  now: number = Date.now()
): Promise<SecondFactorResult> {
  const raw = String(input || "").replace(/\s/g, "");
  const totp = isTotpFormat(raw);
  const backup = totp ? null : normalizeBackupCode(raw);
  if (!totp && !backup) return { ok: false, reason: "format" };

  const tf = await db.query(
    `SELECT secret, secret_iv, secret_tag, secret_key_version, backup_codes
       FROM user_two_factor WHERE user_id = $1`,
    [userId]
  );
  const row = tf.rows[0];
  if (!row?.secret) return { ok: false, reason: "not-enrolled" };

  if (totp) {
    // Guard the decrypt: a missing/rotated DOCUMENT_ENCRYPTION_KEY or a corrupt
    // iv/tag must not throw out of sign-in (that 500s the whole login). The
    // person can still use a backup code.
    let plainSecret: string | null = null;
    try {
      plainSecret = resolveTotpSecret(row, userId);
    } catch (err) {
      console.error("TOTP secret decrypt failed:", err);
    }
    const step = plainSecret ? matchTotpStep(raw, plainSecret, now) : null;
    if (step === null) return { ok: false, reason: "mismatch" };
    if (!(await consumeTotpStep(db, userId, step))) return { ok: false, reason: "replay" };

    // Backfill-on-next-use (Phase 1C): a row from before TOTP-secret-at-rest
    // encryption is re-encrypted now that possession is proven. Best-effort.
    if (plainSecret && !row.secret_iv) {
      try {
        const enc = encryptTotpSecret(plainSecret, userId);
        await db.query(
          `UPDATE user_two_factor
              SET secret = $2, secret_iv = $3, secret_tag = $4, secret_key_version = $5, updated_at = now()
            WHERE user_id = $1`,
          [userId, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion]
        );
      } catch (err) {
        console.error("TOTP secret backfill-encrypt failed:", err);
      }
    }
    return { ok: true, method: "totp" };
  }

  // Backup code -- consumption must be atomic. A plain SELECT-then-UPDATE lets
  // two concurrent requests both pass bcrypt.compare on the same code. The
  // UPDATE repeats the exact snapshot just read, so only the first writer
  // matches a row; the second gets rowCount 0 and is refused as already used.
  if (Array.isArray(row.backup_codes)) {
    const snapshot = row.backup_codes as string[];
    for (let i = 0; i < snapshot.length; i++) {
      if (await bcrypt.compare(backup as string, snapshot[i])) {
        const remaining = snapshot.filter((_, j) => j !== i);
        const upd = await db.query(
          `UPDATE user_two_factor
              SET backup_codes = $3::jsonb
            WHERE user_id = $1 AND backup_codes = $2::jsonb`,
          [userId, JSON.stringify(snapshot), JSON.stringify(remaining)]
        );
        return upd.rowCount === 1
          ? { ok: true, method: "backup" }
          : { ok: false, reason: "replay" };
      }
    }
  }
  return { ok: false, reason: "mismatch" };
}
