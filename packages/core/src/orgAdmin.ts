/**
 * Platform-admin organization setup: create an organization with an owner,
 * then run it (add seats, set the daily limit, rotate the code, change the
 * owner).
 *
 * Before this, the admin mint form made a code with no owner and the old
 * workspace, and the only way to give an organization an owner was the demo
 * seed script or a hand-written production write (R3 review B4).
 *
 * WHO MAY CALL THIS: a platform admin, checked at the route by
 * requirePlatformAdmin (database role plus a second-factor session). Nothing
 * in this file checks it again; do not call these from any other route.
 *
 * WHAT IT WRITES: access_code (the organization's own row, not row-level
 * protected) and, for a brand-new owner address, a users shell, the same shell
 * the staff and participant invites create. Every write runs with app.user_id
 * set to the admin, so the access_code audit trigger (migration 097) records
 * who acted. Each action also emits an event, best effort.
 *
 * WHAT IT NEVER DOES: release a claimed seat (seats are durable, Troy
 * 2026-06-10), turn on required sharing (a lawyer reads that wording first),
 * or mint a partner-tier code (a partner code raises every participant to
 * partner tier).
 */
import { getOne, runAsUser } from "./db";
import { emitEvent } from "./events";
// One code generator for every org code (also used by the mint route).
import { generateOrgCode } from "./orgCode";

/**
 * A seat code minted at 30 a day keeps the new-account progression caps for
 * its members: progressionAccount treats any other daily limit as a legacy
 * entitlement (apps/consumer/lib/progression-server.ts, legacyLimit !== 30).
 */
export const NEW_ORG_DAILY_LIMIT = 30;
export const MAX_SEATS_PER_ACTION = 1000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreateOrgInput = { name: string; ownerEmail: string; ownerName?: string | null; seats: number };

/** Pure: shape and bounds of a create request. */
export function validateCreateOrgInput(raw: {
  name?: unknown; ownerEmail?: unknown; ownerName?: unknown; seats?: unknown;
}): { ok: true; value: CreateOrgInput } | { ok: false; error: string } {
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  const ownerEmail = String(raw.ownerEmail ?? "").trim().toLowerCase();
  const ownerName = String(raw.ownerName ?? "").trim() || null;
  const seats = Number(raw.seats);
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Give the organization a name (2 to 120 characters)." };
  if (!EMAIL.test(ownerEmail) || ownerEmail.length > 254) return { ok: false, error: "Enter the owner's email address." };
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS_PER_ACTION) {
    return { ok: false, error: `Seats must be a whole number from 1 to ${MAX_SEATS_PER_ACTION}. An organization always has a seat limit.` };
  }
  return { ok: true, value: { name, ownerEmail, ownerName, seats } };
}

/** Pure: a positive whole number of seats to add. */
export function validateSeatsToAdd(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS_PER_ACTION) {
    return { ok: false, error: `Add a whole number of seats from 1 to ${MAX_SEATS_PER_ACTION}.` };
  }
  return { ok: true, value: n };
}

/** Pure: the per-person daily limit for members of an organization. */
export function validateDailyLimit(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: "The daily limit must be a whole number from 1 to 1000." };
  return { ok: true, value: n };
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === "23505" || /duplicate|unique/i.test(String((err as { message?: string })?.message ?? ""));

const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;

function logAdminEvent(actorUserId: string, action: string, payload: Record<string, unknown>) {
  // The event table needs a real org FK and this sentinel may not exist, so
  // this can fail quietly. The durable record is the access_code audit trigger
  // in org_audit (migration 097). Never put the code itself in the payload.
  emitEvent({
    org_id: "00000000-0000-0000-0000-000000000000",
    project_id: null, run_id: null, step_id: null,
    event_type: "ORG_ADMIN_CHANGED",
    severity: "info",
    actor_type: "admin",
    actor_user_id: actorUserId,
    actor_label: null,
    data_classification: "internal",
    retention_class: "long",
    correlation_id: null, parent_event_id: null,
    payload: { action, ...payload },
    sensitive_ref: null,
  }).catch(() => {});
}

export type OrgAdminResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

/** Does this account already own another active organization? It would land there first (resolveOrgActor pins the earliest). */
async function ownsOtherActiveOrg(userId: string, exceptOrgId: string | null): Promise<boolean> {
  const row = await getOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM access_code
      WHERE partner_user_id = $1 AND is_active = true AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptOrgId]
  );
  return Number(row?.n ?? 0) > 0;
}

const PINNED_WARNING =
  "That account already owns another active organization. It will open the older one first until that one is turned off.";

/**
 * Create an organization with its owner, in one statement.
 *
 * The owner is found by email. An address with no account gets a shell
 * account, as the staff invite makes one; the route then emails a sign-in
 * link. Tier client, daily limit 30, the new workspace on, required sharing
 * off, and a random code.
 */
export async function createOrganization(
  input: CreateOrgInput,
  actorUserId: string
): Promise<OrgAdminResult<{ orgId: string; code: string; ownerUserId: string; ownerCreated: boolean; warning?: string }>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateOrgCode();
    try {
      const [rows] = await runAsUser<[{ id: string; code: string; owner_id: string; owner_created: boolean }[]]>(actorUserId, (sql) => [
        run(sql)(
          `WITH existing AS (SELECT id FROM users WHERE email = $1),
                made AS (
                  INSERT INTO users (name, email, tier)
                  SELECT $2, $1, 'partner' WHERE NOT EXISTS (SELECT 1 FROM existing)
                  ON CONFLICT (email) DO NOTHING
                  RETURNING id
                ),
                owner AS (SELECT id, false AS created FROM existing UNION ALL SELECT id, true AS created FROM made),
                org AS (
                  INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions, created_by,
                                           partner_user_id, crm_v2, required_sharing_enabled)
                  SELECT $3, $4, 'client', $5::int, $6::int, $7, (SELECT id FROM owner LIMIT 1), true, false
                   WHERE EXISTS (SELECT 1 FROM owner)
                  RETURNING id, code, partner_user_id
                )
           SELECT org.id, org.code, org.partner_user_id AS owner_id,
                  COALESCE((SELECT created FROM owner LIMIT 1), false) AS owner_created
             FROM org`,
          [input.ownerEmail, input.ownerName, code, input.name, NEW_ORG_DAILY_LIMIT, input.seats, actorUserId]
        ),
      ]);
      const row = rows?.[0];
      if (!row) return { ok: false, error: "The organization was not created. Try again." };
      logAdminEvent(actorUserId, "create", { orgId: row.id, seats: input.seats, ownerCreated: row.owner_created });
      const warning = (await ownsOtherActiveOrg(row.owner_id, row.id)) ? PINNED_WARNING : undefined;
      return { ok: true, orgId: row.id, code: row.code, ownerUserId: row.owner_id, ownerCreated: row.owner_created, warning };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 3) continue; // a code collision: draw again
      console.error("createOrganization failed:", (err as Error)?.message || err);
      return { ok: false, error: "The organization was not created. Try again." };
    }
  }
  return { ok: false, error: "The organization was not created. Try again." };
}

/** Add seats to an organization that has a seat limit. Never takes seats away. */
export async function addOrgSeats(orgId: string, seats: number, actorUserId: string): Promise<OrgAdminResult<{ seatsTotal: number }>> {
  const v = validateSeatsToAdd(seats);
  if (!v.ok) return v;
  const [rows] = await runAsUser<[{ max_redemptions: number }[]]>(actorUserId, (sql) => [
    run(sql)(
      `UPDATE access_code SET max_redemptions = max_redemptions + $2::int, updated_at = now()
        WHERE id = $1::uuid AND max_redemptions IS NOT NULL
        RETURNING max_redemptions`,
      [orgId, v.value]
    ),
  ]);
  if (!rows?.[0]) return { ok: false, error: "No change. That organization was not found, or it has no seat limit to add to." };
  logAdminEvent(actorUserId, "add_seats", { orgId, added: v.value, total: rows[0].max_redemptions });
  return { ok: true, seatsTotal: rows[0].max_redemptions };
}

/** Pure: the staff cap for an organization (staff hold a Refinery seat outside the participant seats). */
export function validateStaffCap(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return { ok: false, error: "The staff limit must be a whole number from 0 to 1000." };
  return { ok: true, value: n };
}

/**
 * Set how many staff places an organization has (access_code.max_staff,
 * migration 097). Lowering it below the current staff count removes nobody;
 * it only stops new staff until someone leaves.
 */
export async function setOrgStaffCap(orgId: string, maxStaff: number, actorUserId: string): Promise<OrgAdminResult<{ maxStaff: number }>> {
  const v = validateStaffCap(maxStaff);
  if (!v.ok) return v;
  const [rows] = await runAsUser<[{ max_staff: number }[]]>(actorUserId, (sql) => [
    run(sql)(`UPDATE access_code SET max_staff = $2::int, updated_at = now() WHERE id = $1::uuid RETURNING max_staff`, [orgId, v.value]),
  ]);
  if (!rows?.[0]) return { ok: false, error: "That organization was not found." };
  logAdminEvent(actorUserId, "set_staff_cap", { orgId, maxStaff: v.value });
  return { ok: true, maxStaff: rows[0].max_staff };
}

/** Set the per-person daily limit for members. 30 keeps the new-account caps. */
export async function setOrgDailyLimit(orgId: string, limit: number, actorUserId: string): Promise<OrgAdminResult<{ dailyLimit: number }>> {
  const v = validateDailyLimit(limit);
  if (!v.ok) return v;
  const [rows] = await runAsUser<[{ daily_limit: number }[]]>(actorUserId, (sql) => [
    run(sql)(
      `UPDATE access_code SET daily_limit = $2::int, updated_at = now()
        WHERE id = $1::uuid AND tier = 'client' RETURNING daily_limit`,
      [orgId, v.value]
    ),
  ]);
  if (!rows?.[0]) return { ok: false, error: "No change. Only a seat code (client journey) can have its daily limit set here." };
  logAdminEvent(actorUserId, "set_daily_limit", { orgId, dailyLimit: v.value });
  return { ok: true, dailyLimit: rows[0].daily_limit };
}

/**
 * Replace the code with a new random one. The organization, its members and
 * its seats stay: an organization IS this row, so the row is kept and only the
 * code string changes. The old code stops working at once, including in any
 * /access link or cookie that still carries it.
 */
export async function rotateOrgCode(orgId: string, actorUserId: string): Promise<OrgAdminResult<{ code: string }>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateOrgCode();
    try {
      const [rows] = await runAsUser<[{ code: string }[]]>(actorUserId, (sql) => [
        run(sql)(`UPDATE access_code SET code = $2, updated_at = now() WHERE id = $1::uuid RETURNING code`, [orgId, code]),
      ]);
      if (!rows?.[0]) return { ok: false, error: "That organization was not found." };
      logAdminEvent(actorUserId, "rotate_code", { orgId });
      return { ok: true, code: rows[0].code };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 3) continue;
      console.error("rotateOrgCode failed:", (err as Error)?.message || err);
      return { ok: false, error: "The code was not changed. Try again." };
    }
  }
  return { ok: false, error: "The code was not changed. Try again." };
}

/**
 * Set or change who owns an organization. The owner is found by email; an
 * address with no account gets a shell account (the route emails a sign-in
 * link). The previous owner keeps their account and any staff row they hold,
 * and loses ownership.
 */
export async function setOrgOwner(
  orgId: string,
  ownerEmailRaw: string,
  ownerNameRaw: string | null,
  actorUserId: string
): Promise<OrgAdminResult<{ ownerUserId: string; ownerCreated: boolean; previousOwnerUserId: string | null; warning?: string }>> {
  const ownerEmail = String(ownerEmailRaw ?? "").trim().toLowerCase();
  if (!EMAIL.test(ownerEmail)) return { ok: false, error: "Enter the owner's email address." };
  const ownerName = String(ownerNameRaw ?? "").trim() || null;
  const before = await getOne<{ partner_user_id: string | null }>(`SELECT partner_user_id FROM access_code WHERE id = $1`, [orgId]);
  if (!before) return { ok: false, error: "That organization was not found." };
  const [rows] = await runAsUser<[{ owner_id: string; owner_created: boolean }[]]>(actorUserId, (sql) => [
    run(sql)(
      `WITH existing AS (SELECT id FROM users WHERE email = $2),
            made AS (
              INSERT INTO users (name, email, tier)
              SELECT $3, $2, 'partner' WHERE NOT EXISTS (SELECT 1 FROM existing)
              ON CONFLICT (email) DO NOTHING
              RETURNING id
            ),
            owner AS (SELECT id, false AS created FROM existing UNION ALL SELECT id, true AS created FROM made),
            changed AS (
              UPDATE access_code SET partner_user_id = (SELECT id FROM owner LIMIT 1), updated_at = now()
               WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM owner)
              RETURNING partner_user_id
            )
       SELECT changed.partner_user_id AS owner_id, COALESCE((SELECT created FROM owner LIMIT 1), false) AS owner_created FROM changed`,
      [orgId, ownerEmail, ownerName]
    ),
  ]);
  const row = rows?.[0];
  if (!row) return { ok: false, error: "The owner was not changed. Try again." };
  logAdminEvent(actorUserId, "set_owner", { orgId, ownerCreated: row.owner_created, hadOwner: !!before.partner_user_id });
  const warning = (await ownsOtherActiveOrg(row.owner_id, orgId)) ? PINNED_WARNING : undefined;
  return { ok: true, ownerUserId: row.owner_id, ownerCreated: row.owner_created, previousOwnerUserId: before.partner_user_id, warning };
}

/* ------------------------------------------------------------ lifecycle -- */
/*
 * Close, reopen, rename and (for an organization with no history) delete
 * (migration 100). Closed is is_active = false; the database stamps when and
 * who (access_code_lifecycle_sync) and records it in org_audit. Platform
 * admins only, checked at the route by requirePlatformAdmin, as everything in
 * this file.
 */

/** What closing means, in the words the screen shows before anyone confirms. */
export const CLOSED_MEANS =
  "Closing keeps everything. Members keep their accounts and their own work. Staff lose the workspace for this organization. " +
  "Notes, tasks, outcomes and history stay. Nobody new can join with its code, and a Refinery seat that came through it stops counting while it is closed. " +
  "You can reopen it at any time.";

/** Why delete is refused, in the same plain words. */
export const DELETE_MEANS =
  "Delete is only for an organization made by mistake: nobody ever joined, no staff, no invitations, no notes, tasks, outcomes or other history. " +
  "Anything else is closed, never deleted, so its record stays.";

/** Pure: an organization's name. */
export function validateOrgName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Give the organization a name (2 to 120 characters)." };
  return { ok: true, value: name };
}

/** Pure: why it is being closed. Required, short. */
export function validateCloseReason(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const reason = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 3) return { ok: false, error: "Say in a few words why it is closing. Only platform admins see this." };
  if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };
  return { ok: true, value: reason };
}

/** Close an open organization, with the reason. */
export async function closeOrganization(orgId: string, reasonRaw: unknown, actorUserId: string): Promise<OrgAdminResult<{ closedAt: string }>> {
  const v = validateCloseReason(reasonRaw);
  if (!v.ok) return v;
  const [rows] = await runAsUser<[{ closed_at: string }[]]>(actorUserId, (sql) => [
    run(sql)(
      `UPDATE access_code SET is_active = false, close_reason = $2, closed_by = $3::uuid, closed_at = now(), updated_at = now()
        WHERE id = $1::uuid AND is_active = true
        RETURNING closed_at`,
      [orgId, v.value, actorUserId]
    ),
  ]);
  if (!rows?.[0]) return { ok: false, error: "No change. That organization is already closed, or it was not found." };
  logAdminEvent(actorUserId, "close", { orgId });
  return { ok: true, closedAt: rows[0].closed_at };
}

/** Reopen a closed organization. Its staff get their workspace back. */
export async function reopenOrganization(orgId: string, actorUserId: string): Promise<OrgAdminResult<{ warning?: string }>> {
  const [rows] = await runAsUser<[{ partner_user_id: string | null }[]]>(actorUserId, (sql) => [
    run(sql)(
      `UPDATE access_code SET is_active = true, updated_at = now()
        WHERE id = $1::uuid AND is_active = false
        RETURNING partner_user_id`,
      [orgId]
    ),
  ]);
  if (!rows?.[0]) return { ok: false, error: "No change. That organization is already open, or it was not found." };
  logAdminEvent(actorUserId, "reopen", { orgId });
  const owner = rows[0].partner_user_id;
  const warning = owner && (await ownsOtherActiveOrg(owner, orgId)) ? PINNED_WARNING : undefined;
  return { ok: true, warning };
}

/** Rename an organization. The code, members and history stay. */
export async function renameOrganization(orgId: string, nameRaw: unknown, actorUserId: string): Promise<OrgAdminResult<{ name: string }>> {
  const v = validateOrgName(nameRaw);
  if (!v.ok) return v;
  const [rows] = await runAsUser<[{ partner_name: string }[]]>(actorUserId, (sql) => [
    run(sql)(`UPDATE access_code SET partner_name = $2, updated_at = now() WHERE id = $1::uuid RETURNING partner_name`, [orgId, v.value]),
  ]);
  if (!rows?.[0]) return { ok: false, error: "That organization was not found." };
  logAdminEvent(actorUserId, "rename", { orgId });
  return { ok: true, name: rows[0].partner_name };
}

/** Every row that would make a delete erase history, counted per table (smr_admin_org_history). Null when not allowed or not found. */
export async function getOrgHistory(orgId: string, actorUserId: string): Promise<Record<string, number> | null> {
  const [rows] = await runAsUser<[{ h: Record<string, number> | null }[]]>(actorUserId, (sql) => [
    run(sql)(`SELECT smr_admin_org_history($1::uuid) AS h`, [orgId]),
  ]);
  const h = rows?.[0]?.h;
  if (!h) return null;
  return Object.fromEntries(Object.entries(h).map(([k, n]) => [k, Number(n)]));
}

const HISTORY_WORDS: Record<string, [string, string]> = {
  access_code_redemption: ["member", "members"],
  access_code_departure: ["person who left", "people who left"],
  org_staff: ["staff member", "staff members"],
  org_staff_invite: ["staff invitation", "staff invitations"],
  org_invite: ["participant invitation", "participant invitations"],
  client_staff_assignment: ["caseload assignment", "caseload assignments"],
  case_note: ["case note", "case notes"],
  staff_task: ["task", "tasks"],
  outcome_record: ["outcome", "outcomes"],
  retention_check: ["retention check", "retention checks"],
  staff_suggestion: ["suggestion", "suggestions"],
  sharing_grant: ["sharing choice", "sharing choices"],
  sharing_request: ["ask to share", "asks to share"],
  org_capability_override: ["access setting", "access settings"],
  refinery_access_policy: ["Refinery house setting", "Refinery house settings"],
  audited_changes: ["recorded change", "recorded changes"],
};

/** Pure: the history as one plain sentence ("3 members, 1 staff member and 12 recorded changes"). Empty when there is none. */
export function describeOrgHistory(h: Record<string, number> | null | undefined): string {
  const parts = Object.entries(h ?? {})
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => {
      const words = HISTORY_WORDS[k] ?? [k.replace(/_/g, " ") + " row", k.replace(/_/g, " ") + " rows"];
      return `${n} ${Number(n) === 1 ? words[0] : words[1]}`;
    });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const DELETE_REFUSALS: Record<string, string> = {
  refused: "Only a platform admin can delete an organization.",
  not_found: "That organization was not found.",
  name_mismatch: "Type the organization's name exactly to delete it.",
  has_history: "This organization has history, so it can only be closed.",
};

/**
 * Delete an organization with no history at all. The database checks again
 * (smr_admin_delete_org): the admin, the typed name, and every table that
 * points at the organization, with the row locked.
 */
export async function deleteEmptyOrganization(orgId: string, confirmName: unknown, actorUserId: string): Promise<OrgAdminResult<{ deleted: true }>> {
  const history = await getOrgHistory(orgId, actorUserId);
  if (history && Object.keys(history).length > 0) {
    return { ok: false, error: `${DELETE_REFUSALS.has_history} It has ${describeOrgHistory(history)}.` };
  }
  const [rows] = await runAsUser<[{ r: string }[]]>(actorUserId, (sql) => [
    run(sql)(`SELECT smr_admin_delete_org($1::uuid, $2) AS r`, [orgId, String(confirmName ?? "")]),
  ]);
  const r = rows?.[0]?.r ?? "refused";
  if (r !== "ok") return { ok: false, error: DELETE_REFUSALS[r] ?? DELETE_REFUSALS.refused };
  logAdminEvent(actorUserId, "delete_empty", { orgId });
  return { ok: true, deleted: true };
}
