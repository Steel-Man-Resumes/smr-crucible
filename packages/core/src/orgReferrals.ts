/**
 * Closed-loop referrals (migration 105, lane L5).
 *
 * A referral is the organization's record that it sent someone somewhere for
 * help, who owns the follow-through, and by when the next look is due. Its
 * status moves only along REFERRAL_TRANSITIONS (the database enforces the same
 * path), and every move lands in referral_event, written by a trigger.
 *
 * CONSENT, as the database states it: a directory listing or "somewhere else"
 * shares nothing with anyone; a partner organization stays a draft until the
 * participant has agreed (no such consent step exists yet, so it stays a draft).
 *
 * Reach: reads and writes carry inReach() in SQL, and the restrictive policy
 * (105 referral_reach) repeats it in the database.
 */
import { query, runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, reachParams, inReach, consentName, today, UUID_RE, DATE_RE } from "./orgWorkflowSql";
import {
  REFERRAL_STATUSES, REFERRAL_TO_KINDS, checkReferralMove, defaultReferralDue, isReferralStatus, PARTNER_CONSENT_LINE,
  type ReferralStatus, type ReferralToKind,
} from "./orgWorkflowShared";

const canView = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");
/** Making and moving referrals is casework, like tasks. */
const canWrite = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.task.write");

export interface Referral {
  id: string; participant_user_id: string; participant_name: string | null;
  to_kind: ReferralToKind; to_resource_id: string | null; to_name: string; reason: string | null;
  status: ReferralStatus; status_reason: string | null;
  owner_staff_id: string | null; owner_name: string | null; due_on: string | null; consent_ok: boolean;
  delivered_at: string | null; closed_at: string | null; created_at: string; updated_at: string; created_by_name: string | null;
}

const COLS = `r.id, r.participant_user_id, ${consentName("r.participant_user_id")} AS participant_name,
  r.to_kind, r.to_resource_id, r.to_name, r.reason, r.status, r.status_reason, r.owner_staff_id, ow.name AS owner_name,
  to_char(r.due_on, 'YYYY-MM-DD') AS due_on, r.consent_ok, r.delivered_at, r.closed_at, r.created_at, r.updated_at, cb.name AS created_by_name`;
const FROM = `FROM referral r LEFT JOIN users ow ON ow.id = r.owner_staff_id LEFT JOIN users cb ON cb.id = r.created_by`;

export type ReferralFilter = ReferralStatus | "open" | "overdue" | "all";
export const REFERRAL_FILTERS: { key: ReferralFilter; label: string }[] = [
  { key: "open", label: "Open" }, { key: "overdue", label: "Past due" }, { key: "all", label: "All" },
  ...REFERRAL_STATUSES.map((s) => ({ key: s as ReferralFilter, label: s })),
];

/** The statement behind listReferrals, exported so the database test runs it. $4 person, $5 filter, $6 mine, $7 today, $8 limit. */
export const LIST_REFERRALS_SQL = `SELECT ${COLS} ${FROM}
  WHERE r.access_code_id = $1::uuid AND ${inReach("r.participant_user_id")}
    AND ($4::uuid IS NULL OR r.participant_user_id = $4::uuid)
    AND (CASE $5::text
           WHEN 'all' THEN true
           WHEN 'open' THEN r.status <> 'closed'
           WHEN 'overdue' THEN r.status <> 'closed' AND r.due_on < $7::date
           ELSE r.status = $5::text END)
    AND (NOT $6::boolean OR r.owner_staff_id = $3::uuid OR (r.owner_staff_id IS NULL AND r.created_by = $3::uuid))
  ORDER BY (r.status = 'closed'), r.due_on NULLS LAST, r.created_at DESC
  LIMIT $8::int`;

export async function listReferrals(actor: OrgActor, opts: { clientId?: string | null; filter?: string | null; mine?: boolean; limit?: number } = {}): Promise<Referral[] | null> {
  if (!canView(actor)) return null;
  const filter: ReferralFilter = opts.filter === "open" || opts.filter === "overdue" || opts.filter === "all" || isReferralStatus(opts.filter) ? (opts.filter as ReferralFilter) : "open";
  const clientId = opts.clientId && UUID_RE.test(opts.clientId) ? opts.clientId : null;
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 200)));
  const [rows] = await runScoped<[Referral[]]>(scopeOf(actor), (sql) => [
    run(sql)(LIST_REFERRALS_SQL, [...reachParams(actor), clientId, filter, !!opts.mine, today(), limit]),
  ]);
  return rows;
}

/** Overdue referrals this person owns (or made and nobody owns), for Today. */
export async function listOverdueReferralsForToday(actor: OrgActor): Promise<Referral[]> {
  return (await listReferrals(actor, { filter: "overdue", mine: true, limit: 100 })) ?? [];
}

export interface ReferralEvent {
  id: string; from_status: ReferralStatus | null; to_status: ReferralStatus; status_reason: string | null;
  owner_name: string | null; due_on: string | null; actor_name: string | null; at: string;
}

export async function getReferralHistory(actor: OrgActor, referralId: string): Promise<ReferralEvent[] | null> {
  if (!canView(actor) || !UUID_RE.test(referralId)) return null;
  const [rows] = await runScoped<[ReferralEvent[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT e.id, e.from_status, e.to_status, e.status_reason, ow.name AS owner_name, to_char(e.due_on, 'YYYY-MM-DD') AS due_on, au.name AS actor_name, e.at
         FROM referral_event e LEFT JOIN users ow ON ow.id = e.owner_staff_id LEFT JOIN users au ON au.id = e.actor_user_id
        WHERE e.referral_id = $4::uuid AND e.access_code_id = $1::uuid AND ${inReach("e.participant_user_id")}
        ORDER BY e.at`,
      [...reachParams(actor), referralId]
    ),
  ]);
  return rows;
}

type Result = { ok: true; id: string; note?: string } | { ok: false; error: string };

/** The owner ($9) is on staff and reaches the person (S3). The insert and update policies say the same. */
const OWNER_OK = (who: string) => `($9::uuid IS NULL OR public.smr_staff_reach($1::uuid, $9::uuid, ${who}))`;

/** Handing a referral to someone else is assigning work: it needs org.client.assign (S3). */
export function canHandOff(actor: OrgActor, ownerId: string | null | undefined): boolean {
  return !ownerId || ownerId === actor.userId || actor.capabilities.has("org.client.assign");
}
const HAND_OFF_REFUSED = "Handing a referral to someone else is for people who assign work. Keep it, or ask an admin.";

/**
 * The writes, exported so the database test runs these exact statements.
 * insert: $4 person, $5 to_kind, $6 resource, $7 to_name, $8 reason, $9 owner, $10 status, $11 due.
 * move:   $4 referral, $5 status it must still be in, $6 new status, $7 reason, $8 due.
 */
export const REFERRAL_SQL = {
  insert: `INSERT INTO referral (access_code_id, participant_user_id, to_kind, to_resource_id, to_name, reason, status, owner_staff_id, due_on, created_by)
         SELECT $1::uuid, $4::uuid, $5, $6::uuid, $7, $8, $10, $9::uuid, $11::date, $3::uuid
          WHERE ${inReach("$4::uuid")} AND ${OWNER_OK("$4::uuid")}
         RETURNING id`,
  move: `UPDATE referral r SET status = $6, status_reason = $7, due_on = $8::date
          WHERE r.id = $4::uuid AND r.access_code_id = $1::uuid AND r.status = $5 AND ${inReach("r.participant_user_id")}
         RETURNING r.id`,
};

export async function createReferral(actor: OrgActor, input: {
  clientId: string; toKind: string; resourceId?: string | null; toName?: string | null; reason?: string | null;
  send?: boolean; ownerId?: string | null; dueOn?: string | null;
}): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_RE.test(input.clientId ?? "")) return { ok: false, error: "That person is not on your caseload." };
  if (!(REFERRAL_TO_KINDS as readonly string[]).includes(input.toKind)) return { ok: false, error: "Say where the referral is to." };
  const toKind = input.toKind as ReferralToKind;
  let toName = (input.toName ?? "").trim();
  let resourceId: string | null = null;
  if (toKind === "directory_resource") {
    if (!UUID_RE.test(input.resourceId ?? "")) return { ok: false, error: "Pick a listing from the directory." };
    const hit = await getDirectoryListing(input.resourceId!);
    if (!hit) return { ok: false, error: "That listing is not in the directory any more. Pick another, or choose somewhere else." };
    resourceId = hit.service_id;
    toName = listingName(hit);
  }
  if (toName.length < 2 || toName.length > 200) return { ok: false, error: "Name the place or person it is to." };
  const reason = (input.reason ?? "").trim() || null;
  if (reason && reason.length > 1000) return { ok: false, error: "Keep the reason under 1000 characters." };
  // A partner organization is never "sent" before the person agrees. Make it a draft and say why.
  const wantSend = !!input.send;
  const status: ReferralStatus = wantSend && toKind !== "partner_org" ? "sent" : "draft";
  const due = input.dueOn && DATE_RE.test(input.dueOn) ? input.dueOn : defaultReferralDue(status, today());
  const owner = input.ownerId && UUID_RE.test(input.ownerId) ? input.ownerId : actor.userId;
  if (!canHandOff(actor, owner)) return { ok: false, error: HAND_OFF_REFUSED };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        REFERRAL_SQL.insert,
        [...reachParams(actor), input.clientId, toKind, resourceId, toName, reason, owner, status, due]
      ),
    ]);
    if (!rows[0]) return { ok: false, error: "That person is not on your caseload, or that owner is not on your team." };
    return { ok: true, id: rows[0].id, note: wantSend && toKind === "partner_org" ? PARTNER_CONSENT_LINE : undefined };
  } catch { return { ok: false, error: "That referral did not save." }; }
}

/** Move a referral one step along its path, with the reason the step needs, and set the next look. */
export async function moveReferral(actor: OrgActor, referralId: string, input: { to: string; reason?: string | null; dueOn?: string | null }): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_RE.test(referralId) || !isReferralStatus(input.to)) return { ok: false, error: "That referral is not on your caseload." };
  const [cur] = await runScoped<[{ status: ReferralStatus; delivered: boolean; to_kind: ReferralToKind; consent_ok: boolean }[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT r.status, (r.delivered_at IS NOT NULL) AS delivered, r.to_kind, r.consent_ok FROM referral r
               WHERE r.id = $4::uuid AND r.access_code_id = $1::uuid AND ${inReach("r.participant_user_id")}`, [...reachParams(actor), referralId]),
  ]);
  const row = cur[0];
  if (!row) return { ok: false, error: "That referral is not on your caseload." };
  const reason = (input.reason ?? "").trim() || null;
  const check = checkReferralMove({ from: row.status, to: input.to, delivered: row.delivered, reason, toKind: row.to_kind, consentOk: row.consent_ok });
  if (!check.ok) return check;
  const due = input.dueOn && DATE_RE.test(input.dueOn) ? input.dueOn : defaultReferralDue(input.to, today());
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      // status = $5: if someone else moved it a moment ago, this changes nothing and says so.
      run(sql)(REFERRAL_SQL.move,
        [...reachParams(actor), referralId, row.status, input.to, reason, due]),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "Someone else just changed this referral. Reload and look again." };
  } catch { return { ok: false, error: "That change did not save." }; }
}

/** Hand it to a colleague, change the date, or (while still a draft) fix where it is to and why. */
export async function updateReferral(actor: OrgActor, referralId: string, input: { ownerId?: string | null; dueOn?: string | null; toName?: string | null; reason?: string | null }): Promise<Result> {
  if (!canWrite(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID_RE.test(referralId)) return { ok: false, error: "That referral is not on your caseload." };
  const owner = input.ownerId === undefined ? undefined : input.ownerId && UUID_RE.test(input.ownerId) ? input.ownerId : null;
  // Clearing the owner or naming someone else both reassign the work.
  if (owner !== undefined && owner !== actor.userId && !actor.capabilities.has("org.client.assign")) return { ok: false, error: HAND_OFF_REFUSED };
  const due = input.dueOn === undefined ? undefined : input.dueOn && DATE_RE.test(input.dueOn) ? input.dueOn : null;
  const toName = input.toName == null ? null : input.toName.trim();
  if (toName !== null && (toName.length < 2 || toName.length > 200)) return { ok: false, error: "Name the place or person it is to." };
  const reason = input.reason == null ? null : input.reason.trim().slice(0, 1000);
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE referral r SET
            owner_staff_id = CASE WHEN $5::boolean THEN $9::uuid ELSE r.owner_staff_id END,
            due_on = CASE WHEN $6::boolean THEN $10::date ELSE r.due_on END,
            to_name = CASE WHEN $7::text IS NOT NULL AND r.status = 'draft' AND r.to_kind <> 'directory_resource' THEN $7 ELSE r.to_name END,
            reason = CASE WHEN $8::text IS NOT NULL AND r.status = 'draft' THEN NULLIF($8, '') ELSE r.reason END
          WHERE r.id = $4::uuid AND r.access_code_id = $1::uuid AND r.status <> 'closed' AND ${inReach("r.participant_user_id")}
            AND ${OWNER_OK("r.participant_user_id")}
          RETURNING r.id`,
        [...reachParams(actor), referralId, owner !== undefined, due !== undefined, toName, reason, owner ?? null, due ?? null]
      ),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, error: "Nothing changed. It may be closed, or that person is not on your team." };
  } catch { return { ok: false, error: "That change did not save." }; }
}

/** Who a referral can be handed to: the owner and staff of this organization (names only). */
export async function listReferralOwners(actor: OrgActor): Promise<{ id: string; name: string | null }[]> {
  if (!canView(actor) || !actor.capabilities.has("org.staff.view")) return [];
  const [rows] = await runScoped<[{ id: string; name: string | null }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT u.id, u.name FROM users u
        WHERE u.id = (SELECT a.partner_user_id FROM access_code a WHERE a.id = $1::uuid)
           OR u.id IN (SELECT s.user_id FROM org_staff s WHERE s.access_code_id = $1::uuid)
        ORDER BY u.name NULLS LAST LIMIT 200`, [actor.orgId]),
  ]);
  return rows;
}

/* ---------------------------------------------------- the help directory, read only -- */

export interface DirectoryListing { service_id: string; org_name: string | null; service_name: string | null; city: string | null; state: string | null; phone: string | null; last_checked: string | null }

export function listingName(l: Pick<DirectoryListing, "org_name" | "service_name">): string {
  const org = (l.org_name ?? "").trim(), svc = (l.service_name ?? "").trim();
  return (org && svc && svc.toLowerCase() !== org.toLowerCase() ? `${org}: ${svc}` : org || svc || "Directory listing").slice(0, 200);
}

/**
 * Checked public listings by name or town. Nothing about the participant goes
 * into this search: staff type a place or a need, never a person.
 */
export async function findDirectoryListings(q: string, state?: string | null): Promise<DirectoryListing[]> {
  const term = (q ?? "").trim().slice(0, 80);
  if (term.length < 2) return [];
  const st = state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null;
  return query<DirectoryListing>(
    `SELECT service_id, org_name, service_name, city, state, phone, to_char(last_checked, 'YYYY-MM-DD') AS last_checked
       FROM resource_app_v
      WHERE (org_name ILIKE '%' || $1 || '%' OR service_name ILIKE '%' || $1 || '%' OR city ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR state = $2)
      ORDER BY last_checked DESC NULLS LAST, org_name LIMIT 8`,
    [term.replace(/[%_\\]/g, (c) => "\\" + c), st]
  );
}

async function getDirectoryListing(serviceId: string): Promise<DirectoryListing | null> {
  const rows = await query<DirectoryListing>(
    `SELECT service_id, org_name, service_name, city, state, phone, to_char(last_checked, 'YYYY-MM-DD') AS last_checked FROM resource_app_v WHERE service_id = $1::uuid LIMIT 1`,
    [serviceId]
  );
  return rows[0] ?? null;
}
