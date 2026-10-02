/**
 * Account pre-hijack fix (F3, 2026-10-02): the first proof of the inbox wipes
 * credentials set by someone who never proved it.
 *
 * THE HOLE. /api/auth/register creates an account with a password and no proof
 * that the person owns the address. Someone could register another person's
 * email, set a password (and two-step), and wait. The real owner, told "an
 * account with this email already exists, use the email link", would sign in by
 * link or Google and fill the account with their resume, record and
 * disclosure work, while the first person kept signing in with the password.
 *
 * THE RULE. users.email_proven_at (migration 068) is set the first time the
 * inbox is proven: an email-link sign-in, a Google sign-in Google verified, or
 * a password reset by email link. Register leaves it NULL. When an unproven
 * account is proven and has a password or two-step on it, those were set by
 * someone who never showed they own the address, so in one transaction:
 * password removed, two-step removed, every session signed out, and the
 * address marked proven. An account with nothing to wipe is just marked proven.
 *
 * Accounts that existed before 068 are backfilled as proven (see the
 * migration), so only accounts created after it are ever wiped.
 *
 * Runs in the Auth.js signIn callback (Node, /api/auth route) and in
 * reset-confirm. Until 068 runs the column is missing and this does nothing.
 */
import type { Db } from "@/lib/session-registry";
import { revokeUserSessions } from "@/lib/session-registry";

export interface ProofState {
  provenAt: unknown;
  hasPassword: boolean;
  twoFactor: boolean;
}

/** What proving the inbox does to this account. */
export function inboxProofAction(
  state: ProofState,
  opts: { clearPassword: boolean }
): "none" | "prove" | "wipe" {
  if (state.provenAt) return "none";
  const credentials = (opts.clearPassword && state.hasPassword) || state.twoFactor;
  return credentials ? "wipe" : "prove";
}

/** Postgres "undefined_column": migration 068 not applied yet. */
const UNDEFINED_COLUMN = "42703";

/** A pool (connect for a transaction) or a single client. */
export interface Connectable {
  connect: () => Promise<Db & { release: () => void }>;
}

/**
 * Apply the rule to the account with this email (case-insensitive).
 * `clearPassword` is false for a reset, which has just set the owner's own
 * new password; two-step set by someone else is still removed.
 */
export async function applyInboxProof(
  pool: Connectable,
  email: string,
  opts: { clearPassword: boolean; revokeSessions: boolean; userAgent?: string | null }
): Promise<"none" | "proven" | "wiped" | "unavailable"> {
  if (!email) return "none";
  const client = await pool.connect();
  try {
    let row: any;
    try {
      const r = await client.query(
        `SELECT id, email_proven_at, password_hash IS NOT NULL AS has_password, two_factor_enabled
           FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [email]
      );
      row = r.rows[0];
    } catch (err: any) {
      if (err?.code === UNDEFINED_COLUMN) {
        console.error("[auth] users.email_proven_at missing (migration 068 not applied); pre-hijack wipe off");
        return "unavailable";
      }
      throw err;
    }
    if (!row) return "none"; // a brand-new account; marked proven at sign-up (auth.ts jwt)

    const action = inboxProofAction(
      { provenAt: row.email_proven_at, hasPassword: !!row.has_password, twoFactor: !!row.two_factor_enabled },
      opts
    );
    if (action === "none") return "none";
    if (action === "prove") {
      await client.query(
        `UPDATE users SET email_proven_at = now() WHERE id = $1 AND email_proven_at IS NULL`,
        [row.id]
      );
      return "proven";
    }

    await client.query("BEGIN");
    try {
      const upd = await client.query(
        opts.clearPassword
          ? `UPDATE users SET password_hash = NULL, two_factor_enabled = false, email_proven_at = now()
              WHERE id = $1 AND email_proven_at IS NULL RETURNING id`
          : `UPDATE users SET two_factor_enabled = false, email_proven_at = now()
              WHERE id = $1 AND email_proven_at IS NULL RETURNING id`,
        [row.id]
      );
      if ((upd.rowCount ?? 0) === 0) {
        // Someone proved it a moment ago; nothing left to do.
        await client.query("ROLLBACK");
        return "none";
      }
      await client.query(`DELETE FROM user_two_factor WHERE user_id = $1`, [row.id]);
      if (opts.revokeSessions) {
        await revokeUserSessions(client, { userId: row.id, userAgent: opts.userAgent ?? null });
      }
      await client.query(
        `INSERT INTO user_login_event (user_id, event, user_agent) VALUES ($1, 'credentials_cleared', $2)`,
        [row.id, opts.userAgent ?? null]
      );
      await client.query("COMMIT");
      return "wiped";
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Mark an account's email proven (sign-up by email link or Google). Ignores a missing column. */
export async function markEmailProven(db: Db, userId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE users SET email_proven_at = now() WHERE id = $1 AND email_proven_at IS NULL`,
      [userId]
    );
  } catch (err: any) {
    if (err?.code !== UNDEFINED_COLUMN) throw err;
  }
}
