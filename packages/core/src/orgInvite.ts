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
import { OFFER_WINDOW_HOURS, createSeatOffer } from "./refineryAccess";

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
  /** Who sent it, so a caller can show each staff member only their own. */
  invitedById: string | null;
}

/** One refusal for re-adding anyone already on the Invited list (invite or offer). */
export const ALREADY_INVITED = "That person is already on your invited list. Use Resend there if they need the email again.";

export type CreateOrgInviteResult =
  | {
      ok: true;
      userId: string;
      /** invited = never signed in, gets a magic-link welcome;
       *  offered = existing account that has signed in: asked first, and the
       *  seat is spent only when they accept (migration 096, R3 S5). */
      kind: "invited" | "offered";
      /** Send the email? False for an offer already made or answered in the
       *  last 24 hours: one email per person per organization per day. */
      notify: boolean;
    }
  | { ok: false; error: string };

/** SQL fragment: the org_invite row `oi` (users row `u`) is on the Invited
 *  list: a new invite nobody has signed in to, or an offer that is open or
 *  was declined. Joined and withdrawn rows are not listed. */
const LISTED_SQL = `(oi.offer_status IN ('offered', 'declined') OR (oi.offer_status IS NULL AND ${PENDING_SQL}))`;

/**
 * Re-open an offer row on the Invited list ($1 org, $2 person, $3 sender,
 * $4 typed name, $5 typed email, $6 email window hours). The row is listed
 * at once, like a re-added new invite (fresh invited_at, one send), and
 * last_sent_at moves only when the email window has passed: `sent` says
 * whether to send. Exported for the pglite test.
 */
export const OFFER_RELIST_SQL = `INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email, offer_status)
     VALUES ($1, $2, $3, $4, $5, 'offered')
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET invited_by = EXCLUDED.invited_by, invited_name = EXCLUDED.invited_name,
                   invited_email = EXCLUDED.invited_email, offer_status = 'offered',
                   invited_at = NOW(), send_count = 1,
                   last_sent_at = CASE WHEN org_invite.last_sent_at <= now() - make_interval(hours => $6)
                                       THEN NOW() ELSE org_invite.last_sent_at END
     RETURNING (last_sent_at = now()) AS sent`;

/**
 * The Invited list. Open offers to existing accounts (096) are listed with the
 * new invites and look exactly like them (CRM re-check, SF-8): the name and
 * email the organization typed, never the account's own name, and one row
 * shape, so the list never says which addresses already had an account. An
 * offered person has signed in, so the never-signed-in test alone would hide
 * the row and staff could neither resend nor withdraw it.
 *
 * A DECLINED offer stays listed, looking like an invite nobody has answered
 * (boss ruling 2026-10-23: the organization never learns of a decline). The
 * decline stays on org_seat_offer, for the person's own history only.
 * Exported for the test.
 */
export const PENDING_INVITE_LIST_SQL = `SELECT oi.user_id,
            CASE WHEN oi.offer_status IS NOT NULL THEN oi.invited_name ELSE u.name END AS name,
            CASE WHEN oi.offer_status IS NOT NULL THEN COALESCE(oi.invited_email, u.email) ELSE u.email END AS email,
            oi.invited_at, oi.last_sent_at,
            oi.send_count, inviter.name AS invited_by_name, oi.invited_by
       FROM org_invite oi
       JOIN users u ON u.id = oi.user_id
       LEFT JOIN users inviter ON inviter.id = oi.invited_by
      WHERE oi.access_code_id = $1 AND ${LISTED_SQL}
      ORDER BY oi.invited_at DESC`;

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
    invited_by: string | null;
  }>(
    PENDING_INVITE_LIST_SQL,
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
    invitedById: r.invited_by,
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

  if (existing) {
    // Already on this organization's Invited list, as a new invite or as an
    // offer (open or declined, which look the same): one answer for all. Without this an invite came back
    // "already part of your organization" (its shell holds a seat here) while
    // an offer went through, so re-adding a listed person would tell staff
    // which one already had an account (SF-8, add path).
    const listed = await getOne<{ one: number }>(
      `SELECT 1 AS one FROM org_invite oi JOIN users u ON u.id = oi.user_id
        WHERE oi.access_code_id = $1 AND oi.user_id = $2 AND ${LISTED_SQL}`,
      [opts.accessCodeId, existing.id]
    );
    if (listed) return { ok: false, error: ALREADY_INVITED };
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
    userId = existing.id;
    const pending = await getOne<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.id = $1 AND ${PENDING_SQL}`,
      [userId]
    );
    if (!pending) {
      // CONSENT ON ATTACH (R3 S5). This account has been used by its owner, so
      // it is theirs to say yes to: the organization makes an offer, and the
      // seat is spent only when the person accepts (smr_accept_seat_offer).
      // Fail fast on a full or closed code so the offer is not a dead end.
      const v = await validateAccessCode(opts.code);
      if (!v.valid) return { ok: false, error: v.reason || "This code is not accepting new seats." };
      // A withdrawn offer (or none) is re-opened at once, exactly like a
      // removed new invite added again (boss ruling 2026-10-23): a pending
      // offer exists afterwards, the row is listed with what the org typed,
      // and the email goes only when the 24-hour window since the last send
      // has passed. Staff get the one neutral reply either way.
      const sent = await openListedOffer({ accessCodeId: opts.accessCodeId, userId, actorUserId: opts.invitedBy, name: name || null, email });
      return { ok: true, userId, kind: "offered", notify: sent };
    }
    // A shell nobody has signed in to yet (made by an earlier invite): no one
    // to ask, so the seat is claimed now, as for a new invitee.
    const res = await redeemAccessCode(existing.id, opts.code, { actorUserId: opts.invitedBy });
    if (!res.success) return { ok: false, error: res.error || "Could not claim a seat." };
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
  }

  await query(
    `INSERT INTO org_invite (access_code_id, user_id, invited_by, invited_name, invited_email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET last_sent_at = NOW(), send_count = org_invite.send_count + 1`,
    [opts.accessCodeId, userId, opts.invitedBy, name || null, email]
  );

  return { ok: true, userId, kind: "invited", notify: true };
}

/**
 * Make sure the person has a pending offer from this organization (an
 * earlier decline or withdrawal does not block it; only an open one does),
 * then list the row (OFFER_RELIST_SQL). Returns whether to send the email.
 */
export async function openListedOffer(o: {
  accessCodeId: string;
  userId: string;
  actorUserId: string;
  name: string | null;
  email: string;
}): Promise<boolean> {
  await createSeatOffer({ accessCodeId: o.accessCodeId, userId: o.userId, offeredBy: o.actorUserId, windowHours: 0 });
  const row = await getOne<{ sent: boolean }>(OFFER_RELIST_SQL, [
    o.accessCodeId,
    o.userId,
    o.actorUserId || null,
    o.name,
    o.email,
    OFFER_WINDOW_HOURS,
  ]);
  return !!row?.sent;
}

/** Who sent this organization's invite to this person. undefined = no invite; null = no recorded sender. */
export async function getOrgInviteSender(accessCodeId: string, userId: string): Promise<string | null | undefined> {
  const row = await getOne<{ invited_by: string | null }>(
    `SELECT invited_by FROM org_invite WHERE access_code_id = $1 AND user_id = $2`,
    [accessCodeId, userId]
  );
  return row ? row.invited_by : undefined;
}

/**
 * May this person resend or remove a pending invite? Pure.
 * Needs "Invite participants". Someone who sees the whole organization may act
 * on any invite; anyone else only on invites they sent themselves.
 */
export function inviteActionAllowed(input: {
  capabilities: ReadonlySet<string>;
  actorUserId: string;
  /** undefined = no invite exists. */
  invitedBy: string | null | undefined;
}): boolean {
  if (!input.capabilities.has("org.participant.invite")) return false;
  if (input.invitedBy === undefined) return false;
  if (input.capabilities.has("org.client.view_all")) return true;
  return !!input.invitedBy && input.invitedBy === input.actorUserId;
}

/**
 * ONE resend window and ONE refusal for an invite and an offer (security
 * review 3, SF-8). Both kinds sit in the same Invited list, so if an offer
 * waited a day and an invite a minute, two Resend clicks a few minutes apart
 * would tell staff whether the address already had an account. Both wait the
 * offer's day (OFFER_WINDOW_HOURS) and answer with the same words.
 */
export const RESEND_WINDOW_HOURS = OFFER_WINDOW_HOURS;
export const RESEND_TOO_SOON = "That invite went out in the last day. You can resend it once a day has passed.";
export const RESEND_LIMIT_REACHED = "Resend limit reached for this invite. Check the address, or remove and re-add them.";
const RESEND_JOINED = "They have already joined, so there is no invite to resend.";
const RESEND_NONE = "There is no open invite to resend.";

/** The row touchOrgInviteResend reads. Exported for its test. */
export interface ResendRow {
  email: string;
  name: string | null;
  invited_name: string | null;
  send_count: number;
  pending: boolean;
  offer_status: string | null;
}

/** Database calls touchOrgInviteResend makes; a test passes fakes. */
export interface ResendDeps {
  getOne: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
  /** Make sure a pending offer exists (a declined one is asked again). */
  openOffer: (accessCodeId: string, userId: string, actorUserId: string) => Promise<unknown>;
}

const RESEND_DEPS: ResendDeps = {
  getOne,
  openOffer: (accessCodeId, userId, actorUserId) =>
    createSeatOffer({ accessCodeId, userId, offeredBy: actorUserId, windowHours: 0 }),
};

/**
 * Rate-limited resend bookkeeping. Returns the address to send to; the caller
 * sends the offer email (offer: true) or mints a fresh magic link.
 */
export async function touchOrgInviteResend(
  accessCodeId: string,
  userId: string,
  opts: { actorUserId?: string; deps?: Partial<ResendDeps> } = {}
): Promise<{ ok: true; email: string; name: string | null; offer: boolean } | { ok: false; error: string }> {
  const deps: ResendDeps = { ...RESEND_DEPS, ...opts.deps };
  const row = await deps.getOne<ResendRow>(
    `SELECT u.email, u.name, oi.invited_name, oi.send_count, ${PENDING_SQL} AS pending, oi.offer_status
       FROM org_invite oi JOIN users u ON u.id = oi.user_id
      WHERE oi.access_code_id = $1 AND oi.user_id = $2`,
    [accessCodeId, userId]
  );
  if (!row) return { ok: false, error: "No invite found for that person." };
  // An open OFFER to an existing account (096) is checked FIRST: that person
  // has signed in, so the pending test below would call them joined. It gets
  // the offer email, never a sign-in link. A DECLINED offer is listed like
  // an unanswered invite (the org never learns of a decline), so it resends
  // the same way and is asked again. A joined offer answers like a joined
  // invite; a withdrawn one has nothing open.
  const offer = row.offer_status === "offered" || row.offer_status === "declined";
  if (!offer) {
    if (row.offer_status === "joined") return { ok: false, error: RESEND_JOINED };
    if (row.offer_status) return { ok: false, error: RESEND_NONE };
    if (!row.pending) return { ok: false, error: RESEND_JOINED };
  }
  if (Number(row.send_count) >= 10) return { ok: false, error: RESEND_LIMIT_REACHED };
  // The window is checked inside the write, so two quick clicks cannot both
  // pass, and an invitee who signs in between the read and the write is not
  // sent another link.
  const touched = await deps.getOne<{ ok: boolean }>(
    `UPDATE org_invite oi SET last_sent_at = NOW(), send_count = oi.send_count + 1,
            offer_status = CASE WHEN oi.offer_status = 'declined' THEN 'offered' ELSE oi.offer_status END
      WHERE oi.access_code_id = $1 AND oi.user_id = $2
        AND oi.last_sent_at <= now() - make_interval(hours => $3)
        AND (oi.offer_status IN ('offered', 'declined')
             OR (oi.offer_status IS NULL
                 AND EXISTS (SELECT 1 FROM users u WHERE u.id = oi.user_id AND ${PENDING_SQL})))
      RETURNING true AS ok`,
    [accessCodeId, userId, RESEND_WINDOW_HOURS]
  );
  if (!touched) return { ok: false, error: RESEND_TOO_SOON };
  if (offer) await deps.openOffer(accessCodeId, userId, opts.actorUserId ?? "");
  return { ok: true, email: row.email, name: offer ? row.invited_name ?? row.name : row.name, offer };
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
  const row = await getOne<{ email: string; pending: boolean; offer_status: string | null }>(
    `SELECT u.email, ${PENDING_SQL} AS pending, oi.offer_status
       FROM org_invite oi JOIN users u ON u.id = oi.user_id
      WHERE oi.access_code_id = $1 AND oi.user_id = $2`,
    [accessCodeId, userId]
  );
  if (!row) return { ok: false, error: "No invite found for that person." };
  // An open OFFER (096): withdraw it. Nothing was spent, so nothing to refund,
  // and the account is the person's own, so nothing else is touched.
  // A DECLINED offer is listed like an unanswered invite, so Remove takes it
  // off the list the same way; the decline itself stays on org_seat_offer.
  // The second write also covers a decline that lands between the read and
  // the withdraw.
  if (row.offer_status === "offered" || row.offer_status === "declined") {
    const [out] = await runScoped<[{ outcome: string }[]]>(
      { orgId: accessCodeId, userId: actorUserId, role: "org_admin" },
      (sql) => [sql`SELECT public.smr_withdraw_seat_offer(${userId}::uuid) AS outcome`]
    );
    const unlisted = await getOne<{ one: number }>(
      `UPDATE org_invite SET offer_status = 'withdrawn'
        WHERE access_code_id = $1 AND user_id = $2 AND offer_status IN ('offered', 'declined')
        RETURNING 1 AS one`,
      [accessCodeId, userId]
    );
    return out?.[0]?.outcome === "ok" || unlisted ? { ok: true } : { ok: false, error: "There is no open invite to remove." };
  }
  if (row.offer_status === "joined") {
    return { ok: false, error: "They have already joined, so this invite can't be removed." };
  }
  if (row.offer_status) return { ok: false, error: "There is no open invite to remove." };
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
