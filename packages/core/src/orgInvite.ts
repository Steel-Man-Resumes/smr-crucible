/**
 * Org admin-invite (2026-08-05) -- the "add a participant by name" flow.
 *
 * An org admin or staff member enters name + email on the leader dashboard.
 * We pre-provision the account and attribute it via the normal access-code
 * redemption (seat-aware, first-code-wins), so the invitee lands already in
 * the org with zero new attribution machinery. The app layer sends the email;
 * this module owns the DB state transitions.
 *
 * "Pending" is derived from the users row, never stored: a user is pending
 * while they have never signed in by ANY door (no magic-link verification,
 * no password, no OAuth account). First sign-in flips them to joined with no
 * bookkeeping here.
 */

import { query, getOne, runScoped } from "./db";
import { redeemAccessCode, validateAccessCode } from "./accessCode";

/** SQL fragment: the users row aliased `u` has never signed in by any door. */
const PENDING_SQL = `(u."emailVerified" IS NULL
  AND u.password_hash IS NULL
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id))`;

export interface OrgPendingInvite {
  userId: string;
  name: string | null;
  email: string;
  invitedAt: string;
  lastSentAt: string;
  sendCount: number;
  invitedByName: string | null;
}

export type CreateOrgInviteResult =
  | {
      ok: true;
      userId: string;
      /** invited = never signed in, gets a magic-link welcome;
       *  attached = existing active account, gets a notification email. */
      kind: "invited" | "attached";
    }
  | { ok: false; error: string };

/** Invites still waiting on a first sign-in (name/email came from the admin). */
export async function getOrgPendingInvites(
  accessCodeId: string
): Promise<OrgPendingInvite[]> {
  const rows = await query<{
    user_id: string;
    name: string | null;
    email: string;
    invited_at: string;
    last_sent_at: string;
    send_count: number;
    invited_by_name: string | null;
  }>(
    `SELECT oi.user_id, u.name, u.email, oi.invited_at, oi.last_sent_at,
            oi.send_count, inviter.name AS invited_by_name
       FROM org_invite oi
       JOIN users u ON u.id = oi.user_id
       LEFT JOIN users inviter ON inviter.id = oi.invited_by
      WHERE oi.access_code_id = $1 AND ${PENDING_SQL}
      ORDER BY oi.invited_at DESC`,
    [accessCodeId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    invitedAt: r.invited_at,
    lastSentAt: r.last_sent_at,
    sendCount: Number(r.send_count),
    invitedByName: r.invited_by_name,
  }));
}

/**
 * Create an invite: pre-provision (or attach) the account and claim a seat.
 * The caller sends the email afterwards -- an email failure must not leave a
 * half-made account invisible, so state first, email second, and the pending
 * panel's Resend button is the recovery path.
 */
export async function createOrgInvite(opts: {
  accessCodeId: string;
  code: string;
  name: string;
  email: string;
  invitedBy: string;
}): Promise<CreateOrgInviteResult> {
  const email = opts.email.toLowerCase().trim();
  const name = opts.name.trim();

  const existing = await getOne<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email]
  );

  let userId: string;
  let kind: "invited" | "attached";

  if (existing) {
    // Is this person already attached somewhere? That is a question about
    // OTHER organizations' membership rows, which row-level security will not
    // show this org -- correctly. Asked as a plain read it would come back
    // empty and this org would attach somebody who belongs to another one.
    // smr_invite_binding answers with one word and never says which org.
    const [bindingRows] = await runScoped<[{ binding: string }[]]>(
      { orgId: opts.accessCodeId, userId: opts.invitedBy, role: "org_admin" },
      (sql) => [sql`SELECT smr_invite_binding(${existing.id}::uuid) AS binding`]
    );
    const binding = bindingRows?.[0]?.binding;
    if (binding !== "none" && binding !== "this_org" && binding !== "other_org") {
      // Unknown is not "none". Refuse rather than attach on a guess.
      return { ok: false, error: "Could not check that person's membership. Try again." };
    }
    if (binding === "this_org") {
      return { ok: false, error: "That person is already part of your organization." };
    }
    if (binding === "other_org") {
      return {
        ok: false,
        error:
          "That email already belongs to another organization on Steel Man Resumes. Contact Steel Man Resumes if they should move to yours.",
      };
    }
    const res = await redeemAccessCode(existing.id, opts.code, { actorUserId: opts.invitedBy });
    if (!res.success) return { ok: false, error: res.error || "Could not claim a seat." };
    userId = existing.id;
    const pending = await getOne<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.id = $1 AND ${PENDING_SQL}`,
      [userId]
    );
    kind = pending ? "invited" : "attached";
  } else {
    // Fail fast on a full code before creating anything.
    const v = await validateAccessCode(opts.code);
    if (!v.valid) return { ok: false, error: v.reason || "This code is not accepting new seats." };
    const ins = await getOne<{ id: string }>(
      `INSERT INTO users (name, email, tier) VALUES ($1, $2, 'client') RETURNING id`,
      [name || null, email]
    );
    if (!ins) return { ok: false, error: "Could not create the account." };
    userId = ins.id;
    const res = await redeemAccessCode(userId, opts.code, { actorUserId: opts.invitedBy });
    if (!res.success) {
      // Roll back the just-created shell so a full code leaves no orphan.
      await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
      return { ok: false, error: res.error || "Could not claim a seat." };
    }
    kind = "invited";
  }

  await query(
    `INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET last_sent_at = NOW(), send_count = org_invite.send_count + 1`,
    [opts.accessCodeId, userId, opts.invitedBy, name || null, email]
  );

  return { ok: true, userId, kind };
}

/**
 * Rate-limited resend bookkeeping. Returns the address to send to; the caller
 * mints a fresh magic link and sends.
 */
export async function touchOrgInviteResend(
  accessCodeId: string,
  userId: string
): Promise<{ ok: true; email: string; name: string | null } | { ok: false; error: string }> {
  const row = await getOne<{ email: string; name: string | null; last_sent_at: string; send_count: number; pending: boolean }>(
    `SELECT u.email, u.name, oi.last_sent_at, oi.send_count, ${PENDING_SQL} AS pending
       FROM org_invite oi JOIN users u ON u.id = oi.user_id
      WHERE oi.access_code_id = $1 AND oi.user_id = $2`,
    [accessCodeId, userId]
  );
  if (!row) return { ok: false, error: "No invite found for that person." };
  if (!row.pending) return { ok: false, error: "They have already joined -- no invite to resend." };
  if (Number(row.send_count) >= 10) {
    return { ok: false, error: "Resend limit reached for this invite. Check the address, or remove and re-add them." };
  }
  if (Date.now() - new Date(row.last_sent_at).getTime() < 60_000) {
    return { ok: false, error: "That invite just went out. Give it a minute before resending." };
  }
  await query(
    `UPDATE org_invite SET last_sent_at = NOW(), send_count = send_count + 1
      WHERE access_code_id = $1 AND user_id = $2`,
    [accessCodeId, userId]
  );
  return { ok: true, email: row.email, name: row.name };
}

/**
 * Revoke a PENDING invite: free the seat and kill outstanding magic links.
 * Only never-signed-in invitees are revocable --
 * once someone has joined, the durable-seat rule (Troy 2026-06-10) applies
 * and they cannot be removed here. Refunding a never-activated invite's seat
 * is the exception Troy ratified with this feature (2026-08-05).
 */
export async function revokeOrgInvite(
  accessCodeId: string,
  userId: string,
  actorUserId = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await getOne<{ email: string; pending: boolean }>(
    `SELECT u.email, ${PENDING_SQL} AS pending
       FROM org_invite oi JOIN users u ON u.id = oi.user_id
      WHERE oi.access_code_id = $1 AND oi.user_id = $2`,
    [accessCodeId, userId]
  );
  if (!row) return { ok: false, error: "No invite found for that person." };
  if (!row.pending) {
    return { ok: false, error: "They have already joined, so this invite can't be removed." };
  }

  // ONE STATEMENT, scoped to this organization. It used to be four separate
  // writes -- delete the invite, delete the membership, refund the seat,
  // delete the account -- so a failure between any two left the seat counter
  // or the invite list telling a different story from the membership table.
  // The pending check is repeated INSIDE the delete: the read above is only
  // for a friendly message, and somebody can sign in between the two.
  const pendingUser = `EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND ${PENDING_SQL})`;
  await runScoped(
    { orgId: accessCodeId, userId: actorUserId, role: "org_admin" },
    (sql) => [
      (sql as unknown as (s: string, p: unknown[]) => unknown)(
        `WITH freed AS (
           DELETE FROM access_code_redemption
            WHERE user_id = $1 AND access_code_id = $2 AND ${pendingUser}
           RETURNING id
         ), gone AS (
           DELETE FROM org_invite
            WHERE user_id = $1 AND access_code_id = $2 AND ${pendingUser}
           RETURNING id
         )
         UPDATE access_code
            SET times_redeemed = GREATEST(times_redeemed - (SELECT COUNT(*) FROM freed)::int, 0),
                updated_at = NOW()
          WHERE id = $2 AND EXISTS (SELECT 1 FROM freed)`,
        [userId, accessCodeId]
      ),
    ]
  );
  // Outstanding magic links die with the invite.
  await query(`DELETE FROM verification_token WHERE identifier = $1`, [row.email]).catch(
    () => {}
  );
  // THE SHELL ACCOUNT IS LEFT IN PLACE, deliberately. This used to delete it
  // "if it belongs to nothing else" -- and whether it belongs to something
  // else is exactly what one organization cannot see about another. Under
  // row-level security that check would read as "nothing" and delete a person
  // another org had invited, cascading their membership away with them. A
  // never-activated account with no membership is inert; a wrongly deleted one
  // is not recoverable. (Codex review, finding 4.)

  return { ok: true };
}
