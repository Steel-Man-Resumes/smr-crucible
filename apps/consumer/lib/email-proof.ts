/**
 * Account pre-hijack fix (F3, redesigned 2026-10-03): the first proof of the
 * inbox asks the person, instead of silently wiping anything.
 *
 * THE HOLE. /api/auth/register creates an account with a password and no proof
 * that the person owns the address. Someone could register another person's
 * email, set a password (and two-step), and wait. The real owner, told "an
 * account with this email already exists, use the email link", would sign in by
 * link or Google and fill the account with their resume, record and
 * disclosure work, while the first person kept signing in with the password.
 *
 * THE RULE. users.email_proven_at (migration 068) is set the first time the
 * inbox is proven: an email-link sign-in, or a Google sign-in whose address
 * Google verified. Register leaves it NULL. When such a sign-in lands on an
 * account that is still unproven:
 *  - two-step on: the normal code page, plus "I didn't set up two-step on
 *    this account". A correct code shows the person set it up AND has the
 *    inbox: the address is marked proven and nothing changes.
 *  - a password, no two-step: "Enter your password to keep it", plus "I didn't
 *    set a password". The right password marks the address proven and keeps it.
 *  - neither: the address is just marked proven.
 * Choosing "I didn't set..." removes the password, two-step and any Google
 * links, signs out every other session, marks the address proven and emails a
 * notice, in one transaction (wipeUnprovenCredentials). Nothing is removed unless the person
 * signed in through the inbox and chose it.
 *
 * The pending choice rides on the session token as `claim` ("2fa" or
 * "password"), set at sign-in in auth.ts and cleared by the jwt callback only
 * after it re-reads email_proven_at. Until 068 runs the column is missing and
 * none of this happens.
 */
import type { Db } from "@/lib/session-registry";
import { revokeUserSessions } from "@/lib/session-registry";

export interface ProofState {
  provenAt: unknown;
  hasPassword: boolean;
  twoFactor: boolean;
}

export type ProofClaim = "2fa" | "password";

/**
 * What an email-link or verified Google sign-in owes on this account:
 * nothing (already proven), just marking it proven, or one of the two choices.
 */
export function claimForInboxProof(state: ProofState): "none" | "prove" | ProofClaim {
  if (state.provenAt) return "none";
  if (state.twoFactor) return "2fa";
  if (state.hasPassword) return "password";
  return "prove";
}

/** Postgres "undefined_column": migration 068 not applied yet. */
export const UNDEFINED_COLUMN = "42703";

/** Read the proof state, or null when migration 068 has not run. */
export async function readProofState(db: Db, userId: string): Promise<ProofState | null> {
  try {
    const r = await db.query(
      `SELECT email_proven_at, password_hash IS NOT NULL AS has_password, two_factor_enabled
         FROM users WHERE id = $1`,
      [userId]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      provenAt: row.email_proven_at,
      hasPassword: !!row.has_password,
      twoFactor: !!row.two_factor_enabled,
    };
  } catch (err: any) {
    if (err?.code === UNDEFINED_COLUMN) {
      console.error("[auth] users.email_proven_at missing (migration 068 not applied); inbox proof off");
      return null;
    }
    throw err;
  }
}

/**
 * Whether the account's email address has been proven (S1: two-step can only
 * be turned on once it has). True before migration 068 runs, so nothing is
 * blocked by a deploy that goes out ahead of it.
 */
export async function isEmailProven(db: Db, userId: string): Promise<boolean> {
  try {
    const r = await db.query(`SELECT email_proven_at FROM users WHERE id = $1`, [userId]);
    return !!r.rows[0]?.email_proven_at;
  } catch (err: any) {
    if (err?.code === UNDEFINED_COLUMN) return true;
    throw err;
  }
}

/** The answer setup/enable give while the email is not proven yet. */
export const EMAIL_PROOF_NEEDED = {
  error: "Confirm your email address before you turn on two-step verification.",
  needsEmailProof: true,
} as const;

/**
 * HOW the inbox was proven (079, users.email_proof_source; security review 3a
 * Part 2 r1, M2). 068 backfilled email_proven_at on every older account, so
 * email_proven_at alone cannot tell a proof from the backfill. The source is
 * written only by a real proof, and the automatic package email needs it.
 */
export type ProofSource = "email_link" | "google" | "password_reset";

/** The proof a sign-in provider gives: an email link, or Google (its own verified address). */
export function proofSourceFor(provider: unknown): ProofSource | null {
  if (provider === "resend") return "email_link";
  if (provider === "google") return "google";
  return null;
}

/**
 * Mark an account's email proven, and record how (when `source` is given).
 * Never overwrites an earlier proof time or source. Before 079 the source
 * column is missing and only email_proven_at is set; before 068 nothing is.
 */
export async function markEmailProven(db: Db, userId: string, source: ProofSource | null = null): Promise<void> {
  try {
    await db.query(
      `UPDATE users
          SET email_proven_at = COALESCE(email_proven_at, now()),
              email_proof_source = COALESCE(email_proof_source, $2)
        WHERE id = $1 AND (email_proven_at IS NULL OR ($2::text IS NOT NULL AND email_proof_source IS NULL))`,
      [userId, source]
    );
    return;
  } catch (err: any) {
    if (err?.code !== UNDEFINED_COLUMN) throw err;
  }
  try {
    await db.query(
      `UPDATE users SET email_proven_at = now() WHERE id = $1 AND email_proven_at IS NULL`,
      [userId]
    );
  } catch (err: any) {
    if (err?.code !== UNDEFINED_COLUMN) throw err;
  }
}

/**
 * "I didn't set this": remove the password and two-step on a still-unproven
 * account, sign out every other session (the caller's is kept), mark the
 * address proven and record it, in one transaction. `db` must be a single
 * client (not a pool) so BEGIN/COMMIT apply.
 *
 * Returns "already-proven" (and changes nothing) if the address was proven in
 * the meantime: a proven account's credentials are never removed this way.
 */
export async function wipeUnprovenCredentials(
  db: Db,
  input: { userId: string; keepSid: string | null; userAgent?: string | null }
): Promise<"wiped" | "already-proven"> {
  await db.query("BEGIN");
  try {
    const upd = await db.query(
      `UPDATE users SET password_hash = NULL, two_factor_enabled = false, email_proven_at = now()
        WHERE id = $1 AND email_proven_at IS NULL RETURNING id`,
      [input.userId]
    );
    if ((upd.rowCount ?? 0) === 0) {
      await db.query("ROLLBACK");
      return "already-proven";
    }
    await db.query(`DELETE FROM user_two_factor WHERE user_id = $1`, [input.userId]);
    // Every Google (OAuth) link goes too: a link set up by whoever set the
    // password is another way back in. The owner's own Google, if that is how
    // they signed in now, links again by email next time.
    await db.query(`DELETE FROM accounts WHERE "userId" = $1`, [input.userId]);
    await revokeUserSessions(db, {
      userId: input.userId,
      keepSid: input.keepSid,
      userAgent: input.userAgent ?? null,
    });
    await db.query(
      `INSERT INTO user_login_event (user_id, event, user_agent) VALUES ($1, 'credentials_cleared', $2)`,
      [input.userId, input.userAgent ?? null]
    );
    await db.query("COMMIT");
    return "wiped";
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  }
}
