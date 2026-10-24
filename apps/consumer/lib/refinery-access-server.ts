/**
 * Refinery seats, server side: AI admission, seat requests, Troy's decisions
 * and the admin switch. The rules themselves are in lib/refinery-access.ts
 * (pure) and in the database (smr_has_refinery_seat, migration 096).
 *
 * Every function that touches the database takes its database calls through
 * a small `deps` object, so the unit tests can drive each door without Neon.
 */
import { randomUUID } from "node:crypto";
import {
  createOrgInvite,
  getOne,
  getOneAsUser,
  queryAsUser,
  readRefineryGate,
  runAsUser,
  type RefineryGate,
} from "@crucible/core";
import { encryptString } from "@crucible/core/src/crypto";
import { FORGE_AI_WORKFLOWS, SEAT_REQUIRED_MESSAGE, seatAdmissionVerdict, seatFrom } from "./refinery-access";

/* ---------------------------------------------------------- seat lookup -- */

export interface SeatDeps {
  readGate: (userId: string) => Promise<RefineryGate>;
  /** The account email and whether its inbox was proven (users.email_proven_at). */
  readEmail: (userId: string) => Promise<{ email: string | null; proven: boolean } | null>;
  preAuthRaw?: string | null;
}

export const defaultSeatDeps: SeatDeps = {
  readGate: readRefineryGate,
  readEmail: async (userId) => {
    const row = await getOne<{ email: string | null; proven: boolean }>(
      `SELECT email, email_proven_at IS NOT NULL AS proven FROM users WHERE id = $1`,
      [userId]
    );
    return row ? { email: row.email, proven: row.proven === true } : null;
  },
};

/**
 * The switch and this person's seat, with the PARTNER_PRE_AUTH rule applied.
 * The email is read only when it can change the answer (closed, no seat).
 * Throws on a database error; callers decide how to fail.
 */
export async function readSeat(userId: string, deps: SeatDeps = defaultSeatDeps): Promise<RefineryGate> {
  const gate = await deps.readGate(userId);
  if (gate.open || gate.seat) return gate;
  const who = await deps.readEmail(userId);
  return { open: gate.open, seat: seatFrom(false, who?.email ?? null, who?.proven === true, deps.preAuthRaw ?? process.env.PARTNER_PRE_AUTH) };
}

/**
 * AI admission backstop (called from beginAiOperation). Does not trust the
 * session claim: it reads the database on every non-Forge AI call. Returns a
 * 403 Response to refuse, or null to continue. Errors propagate, so admission
 * refuses with its own 503 (fail closed), as it does for every other check.
 */
export async function refinerySeatAdmission(
  userId: string,
  workflow: string,
  deps: SeatDeps = defaultSeatDeps
): Promise<Response | null> {
  if (FORGE_AI_WORKFLOWS.has(workflow)) return null; // the Forge stays free with an account
  const gate = await readSeat(userId, deps);
  if (seatAdmissionVerdict({ workflow, ...gate }) === "pass") return null;
  return Response.json({ code: "seat_required", error: SEAT_REQUIRED_MESSAGE, seatRequired: true }, { status: 403 });
}

/* -------------------------------------------------------- seat requests -- */

export interface SeatRequestInput {
  note?: unknown;
  referredBy?: unknown;
  idempotencyKey?: unknown;
}

export class SeatRequestError extends Error {}

/** Per connection, on top of the per-account limits: a flood of fresh accounts each asking once. */
export const SEAT_REQUEST_PER_IP = { maxRequests: 10, windowMs: 24 * 3_600_000 };

/** Validate and build the summary Troy reads. Pure. */
export function seatRequestSummary(input: SeatRequestInput): { key: string; summary: string } {
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new SeatRequestError("invalid_request");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const ref = typeof input.referredBy === "string" ? input.referredBy.trim() : "";
  if (note && (note.length < 5 || note.length > 1000)) throw new SeatRequestError("invalid_request");
  if (ref.length > 200) throw new SeatRequestError("invalid_request");
  const summary = [
    "Refinery seat request",
    `In their words: ${note || "(no note)"}`,
    `Referred by: ${ref || "(not given)"}`,
    "The contact address is the account email. No other details are attached.",
  ].join("\n");
  return { key, summary };
}

export type SeatRequestResult =
  | { outcome: "has_seat"; message: string }
  | { outcome: "pending"; message: string; requestId: string }
  | { outcome: "limit"; message: string };

/**
 * Ask Troy for a seat: one row in his existing review queue
 * (progression_request, kind 'seat'). Same limits and lock as every other
 * request (3 open, 20 per 30 days), plus one open seat request at a time.
 */
export async function requestSeat(userId: string, input: SeatRequestInput, deps: SeatDeps = defaultSeatDeps): Promise<SeatRequestResult> {
  const { key, summary } = seatRequestSummary(input);
  const gate = await readSeat(userId, deps);
  if (gate.seat) return { outcome: "has_seat", message: "You already have a seat. The Refinery is open to you." };
  const prior = await getOneAsUser<{ id: string; kind: string }>(
    userId,
    "SELECT id, kind FROM progression_request WHERE user_id=$1 AND idempotency_key=$2",
    [userId, key]
  );
  if (prior) {
    if (prior.kind !== "seat") throw new SeatRequestError("request_key_conflict");
    return { outcome: "pending", message: SEAT_REQUEST_PENDING, requestId: prior.id };
  }
  const id = randomUUID();
  const encrypted = encryptString(summary, `${userId}:access-request:${id}`);
  const rows = await runAsUser<unknown[][]>(userId, (sql) => [
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 874))`,
    sql`INSERT INTO progression_request(id,user_id,idempotency_key,kind,step_id,summary_encrypted)
      SELECT ${id}::uuid,${userId}::uuid,${key},'seat','foundation',${JSON.stringify(encrypted)}::jsonb
      WHERE (SELECT count(*) FROM progression_request WHERE user_id=${userId}::uuid AND status IN ('pending','question'))<3
        AND (SELECT count(*) FROM progression_request WHERE user_id=${userId}::uuid AND created_at>=now()-interval '30 days')<20
        AND NOT EXISTS (SELECT 1 FROM progression_request WHERE user_id=${userId}::uuid AND kind='seat' AND status IN ('pending','question'))
      ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,
  ]);
  if (rows[1]?.length) return { outcome: "pending", message: SEAT_REQUEST_PENDING, requestId: id };
  const open = await getOneAsUser<{ id: string }>(
    userId,
    "SELECT id FROM progression_request WHERE user_id=$1 AND kind='seat' AND status IN ('pending','question') ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (open) return { outcome: "pending", message: SEAT_REQUEST_PENDING, requestId: open.id };
  return { outcome: "limit", message: "You have several requests waiting already. Troy will get to them." };
}

export const SEAT_REQUEST_PENDING = "Your request is in. Troy reviews these himself.";

/** This person's seat requests, newest first (for the seat page). */
export async function mySeatRequests(userId: string) {
  return queryAsUser<{ id: string; status: string; decision_note: string | null; created_at: string }>(
    userId,
    "SELECT id,status,decision_note,created_at FROM progression_request WHERE user_id=$1 AND kind='seat' ORDER BY created_at DESC LIMIT 5",
    [userId]
  );
}

/* -------------------------------------------------- Troy's seat decision -- */

/** A refusal the admin page shows as written. */
export class SeatDecisionError extends Error {}

export interface SeatRequestRow {
  id: string;
  user_id: string;
  kind: string;
  status: string;
}

export interface DecideSeatDeps {
  readPolicy: (adminId: string) => Promise<{ house_code_id: string | null } | null>;
  readHouse: (codeId: string) => Promise<{ id: string; code: string; partner_name: string; is_active: boolean } | null>;
  readUser: (userId: string) => Promise<{ email: string | null; name: string | null } | null>;
  invite: typeof createOrgInvite;
  markDecided: (adminId: string, requestId: string, status: "approved" | "denied" | "question", note: string) => Promise<string | null>;
  notify: (kind: "invited" | "offered", to: { email: string; name: string | null }, orgName: string, origin: string) => Promise<void>;
}

export const HOUSE_ORG_MISSING =
  "No house organization is set. Pick your organization under Refinery sign-ups on this page first, then approve.";

/**
 * Approve, deny or ask about a seat request. Approving gives a seat from
 * Troy's own organization through createOrgInvite, the same door as "Add
 * participants": an existing account gets an offer it must accept (the seat
 * is spent then); a never-signed-in shell gets an invite link. State first,
 * email last; an email failure is reported, not hidden.
 */
export async function decideSeatRequest(
  adminId: string,
  r: SeatRequestRow,
  decision: string,
  note: string,
  origin: string,
  deps: DecideSeatDeps
): Promise<{ status: string; emailFailed?: boolean }> {
  if (r.kind !== "seat") throw new Error("not_a_seat_request");
  if (r.status === "approved" || r.status === "denied") return { status: r.status };
  if (decision === "deny" || decision === "question") {
    const status = decision === "deny" ? "denied" : "question";
    return { status: (await deps.markDecided(adminId, r.id, status, note)) ?? r.status };
  }
  if (decision !== "approve") throw new Error("invalid_decision");
  const policy = await deps.readPolicy(adminId);
  if (!policy?.house_code_id) throw new SeatDecisionError(HOUSE_ORG_MISSING);
  const house = await deps.readHouse(policy.house_code_id);
  if (!house || !house.is_active) throw new SeatDecisionError("Your house organization is not active. Pick an active one first.");
  const user = await deps.readUser(r.user_id);
  if (!user?.email) throw new SeatDecisionError("That account has no email address, so it cannot be given a seat this way.");
  const created = await deps.invite({
    accessCodeId: house.id,
    code: house.code,
    name: user.name ?? "",
    email: user.email,
    invitedBy: adminId,
  });
  // A full pool or another organization: the request stays open.
  if (!created.ok) throw new SeatDecisionError(created.error);
  const status = (await deps.markDecided(adminId, r.id, "approved", note)) ?? r.status;
  // Asked already in the last day (createOrgInvite notify false): no second email.
  if (!created.notify) return { status };
  try {
    await deps.notify(created.kind, { email: user.email, name: user.name }, house.partner_name, origin);
    return { status };
  } catch (err) {
    console.error("seat approval email failed:", err instanceof Error ? err.message : err);
    return { status, emailFailed: true };
  }
}

/** The real database and email behind decideSeatRequest. */
export function defaultDecideSeatDeps(): DecideSeatDeps {
  return {
    readPolicy: (adminId) => getOneAsUser<{ house_code_id: string | null }>(adminId, "SELECT house_code_id FROM refinery_access_policy WHERE id"),
    readHouse: (codeId) => getOne(`SELECT id, code, partner_name, is_active FROM access_code WHERE id = $1`, [codeId]),
    readUser: (userId) => getOne(`SELECT email, name FROM users WHERE id = $1`, [userId]),
    invite: createOrgInvite,
    markDecided: async (adminId, requestId, status, note) => {
      const rows = await queryAsUser<{ status: string }>(
        adminId,
        `UPDATE progression_request SET status=$2,
           decision_history=decision_history||jsonb_build_array(jsonb_build_object('status',$2::text,'at',now(),'actor',$3::text)),
           decision_note=$4, decided_by=$3::uuid, decided_at=now()
         WHERE id=$1::uuid AND kind='seat' AND status IN ('pending','question') RETURNING status`,
        [requestId, status, adminId, note.trim()]
      );
      return rows[0]?.status ?? null;
    },
    notify: async (kind, to, orgName, origin) => {
      const { buildInviteEmail, buildOfferEmail, mintInviteMagicLink, sendOrgEmail } = await import("./org-invite-email");
      if (kind === "invited") {
        const url = await mintInviteMagicLink(to.email, origin);
        await sendOrgEmail(to.email, buildInviteEmail({ inviteeName: to.name, inviterName: null, orgName, url, origin }));
      } else {
        await sendOrgEmail(to.email, buildOfferEmail({ inviteeName: to.name, inviterName: null, orgName, origin }));
      }
    },
  };
}

/* ------------------------------------------------------ the admin switch -- */

export interface AdminRefineryPolicy {
  publicSignupOpen: boolean;
  closedAt: string | null;
  houseCodeId: string | null;
  houseName: string | null;
  seatsUsed: number | null;
  seatsMax: number | null;
  legacyCount: number;
  legacyCutoff: string | null;
}

/** Platform admin view of the switch and the house pool. */
export async function readAdminRefineryPolicy(adminId: string): Promise<AdminRefineryPolicy> {
  const p = await getOneAsUser<{ public_signup_open: boolean; closed_at: string | null; house_code_id: string | null; legacy_cutoff: string | null; legacy: number }>(
    adminId,
    "SELECT public_signup_open, closed_at, house_code_id, legacy_cutoff, (SELECT count(*)::int FROM refinery_seat_legacy) AS legacy FROM refinery_access_policy WHERE id"
  );
  if (!p) throw new Error("refinery_policy_unavailable");
  const house = p.house_code_id
    ? await getOne<{ partner_name: string; times_redeemed: number; max_redemptions: number | null }>(
        "SELECT partner_name, times_redeemed, max_redemptions FROM access_code WHERE id = $1",
        [p.house_code_id]
      )
    : null;
  return {
    publicSignupOpen: p.public_signup_open,
    closedAt: p.closed_at,
    houseCodeId: p.house_code_id,
    houseName: house?.partner_name ?? null,
    seatsUsed: house ? Number(house.times_redeemed) : null,
    seatsMax: house?.max_redemptions ?? null,
    legacyCount: Number(p.legacy ?? 0),
    legacyCutoff: p.legacy_cutoff,
  };
}

const HISTORY = (action: string) =>
  `change_history || jsonb_build_array(jsonb_build_object('at',now(),'by',$1::uuid,'action','${action}','previous',to_jsonb(refinery_access_policy)-'change_history'))`;

/** The statements a close runs, in order, in ONE transaction. Exported for the tests. */
export const CLOSE_STATEMENTS = {
  // 1. Serialize closes: a second tab or a retry waits here, then sees "closed".
  lock: "SELECT public_signup_open, legacy_cutoff FROM refinery_access_policy WHERE id FOR UPDATE",
  // 2. Grandfather ONLY on the first close (security review 1, BL-2): when the
  //    switch is open now AND no snapshot was ever taken. Reopening and closing
  //    again never seats the accounts made in between.
  snapshot: `INSERT INTO refinery_seat_legacy (user_id)
    SELECT u.id FROM users u
     WHERE EXISTS (SELECT 1 FROM refinery_access_policy p WHERE p.id AND p.public_signup_open AND p.legacy_cutoff IS NULL)
    ON CONFLICT (user_id) DO NOTHING`,
  // 3. Flip, only if open. The cutoff is set once and never moved.
  flip: `UPDATE refinery_access_policy SET public_signup_open=false, closed_at=now(),
     legacy_cutoff=COALESCE(legacy_cutoff, now()), updated_by=$1::uuid,
     change_history=${HISTORY("close")}, updated_at=now()
   WHERE id AND public_signup_open RETURNING id`,
} as const;

export const ALREADY_CLOSED = "Public sign-ups are already closed. Nothing changed.";

type Runner = (userId: string, build: (sql: any) => unknown[]) => Promise<unknown[][]>;

/**
 * Close public sign-ups. ONE transaction: lock the policy row, take the
 * grandfather snapshot if this is the first close ever, then flip. A close
 * while already closed changes nothing and says so.
 */
export async function closeRefinerySignups(adminId: string, run: Runner = runAsUser as unknown as Runner): Promise<void> {
  const out = await run(adminId, (sql) => [
    (sql as (s: string, p?: unknown[]) => unknown)(CLOSE_STATEMENTS.lock, []),
    (sql as (s: string, p?: unknown[]) => unknown)(CLOSE_STATEMENTS.snapshot, []),
    (sql as (s: string, p?: unknown[]) => unknown)(CLOSE_STATEMENTS.flip, [adminId]),
  ]);
  if (!out[0]?.length) throw new Error("refinery_policy_unavailable");
  if (!out[2]?.length) throw new SeatDecisionError(ALREADY_CLOSED);
}

/**
 * Take one account off the grandfather list (platform admin only; the admin
 * policy on refinery_seat_legacy allows the DELETE). By account email.
 */
export async function removeLegacySeat(adminId: string, email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (!addr || addr.length > 320 || !addr.includes("@")) throw new SeatDecisionError("Enter the account's email address.");
  const rows = await queryAsUser<{ user_id: string }>(
    adminId,
    "DELETE FROM refinery_seat_legacy WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1 LIMIT 1) RETURNING user_id",
    [addr]
  );
  return rows.length > 0;
}

/** Reopen (the rollback). Grandfather rows stay; they are harmless while open. */
export async function openRefinerySignups(adminId: string): Promise<void> {
  const rows = await queryAsUser(
    adminId,
    `UPDATE refinery_access_policy SET public_signup_open=true, updated_by=$1::uuid,
       change_history=${HISTORY("open")}, updated_at=now() WHERE id RETURNING id`,
    [adminId]
  );
  if (!rows.length) throw new Error("refinery_policy_not_changed");
}

/** Set or clear the house organization (Troy's own seat pool). */
export async function setHouseOrg(adminId: string, codeId: string | null): Promise<void> {
  if (codeId !== null) {
    if (!/^[0-9a-f-]{36}$/i.test(codeId)) throw new SeatDecisionError("Pick an organization from the list.");
    const org = await getOne<{ is_active: boolean }>("SELECT is_active FROM access_code WHERE id = $1", [codeId]);
    if (!org?.is_active) throw new SeatDecisionError("That organization is not active.");
  }
  const rows = await queryAsUser(
    adminId,
    `UPDATE refinery_access_policy SET house_code_id=$2::uuid, updated_by=$1::uuid,
       change_history=${HISTORY("house")}, updated_at=now() WHERE id RETURNING id`,
    [adminId, codeId]
  );
  if (!rows.length) throw new Error("refinery_policy_not_changed");
}
