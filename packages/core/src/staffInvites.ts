/**
 * Staff invitations with a lifecycle (migration 100, org_staff_invite).
 *
 * Who is invited, by whom, as what, how many times the email went out, when it
 * expires (14 days), and how it ended: accepted, declined or revoked. Both the
 * organization's Team & access page and Admin > Organizations read the same
 * list (listStaffInvites) and act through the same functions.
 *
 * THREE PATHS (org_staff_invite.path), never shown to an organization:
 *   new_account       no account at that address: a shell account is made so
 *                     the emailed sign-in link works, and nothing else. The
 *                     link lands on /dashboard/invites and the person accepts.
 *   existing_account  the address already has an account: the same, with a
 *                     "sign in to answer" email instead of a sign-in link.
 *   admin_added       a platform admin attached an existing account directly
 *                     (adminAddStaff), from Admin > Organizations.
 *
 * NOBODY IS ON STAFF BEFORE SAYING YES (security review B2). The org_staff
 * row and any volunteer restrictions are written only by
 * smr_answer_staff_invite, which locks the organization and re-checks the
 * inviter, the expiry and the staff places. An expired, revoked or declined
 * invitation grants nothing, whatever the person does later.
 *
 * NOTHING HERE TELLS AN ORGANIZATION WHO HAS AN ACCOUNT (review B1). The
 * organization-facing shape (StaffInvite) carries no path and no account id,
 * and status, counts, staff places and answers are the same for a new
 * address and an existing account.
 *
 * Status is DERIVED from the stamps (staffInviteStatus), never stored, so it
 * cannot drift: revoked, declined, accepted, expired, sent, or pending (saved,
 * no email has gone out yet).
 *
 * Email is the route's job (apps/consumer/lib/org-invite-email.ts, Resend).
 * Addresses that cannot receive email (reserved test domains such as
 * .invalid) are never sent to: isUndeliverableEmail.
 */
import { getOne, query, runAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  isStaffPreset,
  presetOverrideWrites,
  STAFF_PRESETS,
  type StaffPreset,
} from "./authz/capabilities";

export const STAFF_INVITE_TTL_DAYS = 14;

export type StaffInvitePath = "new_account" | "existing_account" | "admin_added";
export type StaffInviteStatus = "pending" | "sent" | "accepted" | "expired" | "revoked" | "declined";

/** Plain words for each status, as the lists show them. */
export const STAFF_INVITE_STATUS_WORDS: Record<StaffInviteStatus, string> = {
  pending: "Saved, no email sent",
  sent: "Sent, waiting for them",
  accepted: "Accepted",
  expired: "Expired",
  revoked: "Revoked",
  declined: "Declined",
};

/** The line shown whenever an address cannot receive email. */
export const UNDELIVERABLE_LINE =
  "This address cannot receive email, so nothing was sent. Share the sign-up link instead.";

/**
 * Reserved names that can never receive mail (RFC 2606 and RFC 6761): the
 * .invalid, .test, .example and .localhost top-level domains and the
 * example.com/.net/.org domains. Demo and test accounts use these on purpose.
 */
export function isUndeliverableEmail(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return true;
  const domain = e.slice(at + 1).replace(/\.$/, "");
  if (!domain || !domain.includes(".")) return true;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (["invalid", "test", "example", "localhost"].includes(tld)) return true;
  return /(^|\.)example\.(com|net|org)$/.test(domain);
}

export interface StaffInviteStamps {
  path: StaffInvitePath;
  sendCount: number;
  expiresAt: string | Date;
  acceptedAt: string | Date | null;
  declinedAt: string | Date | null;
  revokedAt: string | Date | null;
}

/** Pure: the status a row shows. */
export function staffInviteStatus(r: StaffInviteStamps, now: Date = new Date()): StaffInviteStatus {
  if (r.revokedAt) return "revoked";
  if (r.declinedAt) return "declined";
  // Accepted only by saying yes, on every path: signing in is not a yes.
  if (r.acceptedAt) return "accepted";
  if (new Date(r.expiresAt).getTime() <= now.getTime()) return "expired";
  return r.sendCount > 0 ? "sent" : "pending";
}

/** Pure: an invitation that is still open can be resent or revoked. */
export function staffInviteIsOpen(status: StaffInviteStatus): boolean {
  return status === "pending" || status === "sent" || status === "expired";
}

/**
 * One invitation as an ORGANIZATION (and the admin page) sees it. No path and
 * no account id: those would tell the organization whether the address had
 * an account. Only `addedBySupport`, which is a platform admin's act, not a
 * fact about the person.
 */
export interface StaffInvite {
  id: string;
  email: string;
  name: string | null;
  role: "org_admin" | "staff";
  title: string | null;
  /** A platform admin attached this person directly (Admin > Organizations). */
  addedBySupport: boolean;
  /** Starts without these (a preset such as volunteer), applied at accept. */
  volunteer: boolean;
  invitedAt: string;
  invitedByName: string | null;
  sendCount: number;
  lastSentAt: string | null;
  expiresAt: string;
  status: StaffInviteStatus;
  statusWords: string;
  /** The address is a reserved test domain: nothing can be emailed to it. */
  undeliverable: boolean;
  canResend: boolean;
  canRevoke: boolean;
}

/** Server-side only: the invitation with what the organization must not see. */
interface StaffInviteRecord extends StaffInvite {
  userId: string;
  path: StaffInvitePath;
  invitedBy: string | null;
  /** Whoever invited can still invite at this role (owner, platform admin, or an org admin for a staff role). */
  inviterCanInvite: boolean;
}

type InviteRow = {
  id: string; user_id: string; invited_email: string; invited_name: string | null; role: string; title: string | null;
  path: StaffInvitePath; capability_denies: string[] | null; invited_at: string; invited_by: string | null; invited_by_name: string | null;
  send_count: number; last_sent_at: string | null; expires_at: string; accepted_at: string | null;
  declined_at: string | null; revoked_at: string | null; inviter_can_invite: boolean;
};

/**
 * The list both pages read. Exported so the database test runs exactly this.
 * $1 = organization. Runs under that organization's scope (RLS).
 */
export const STAFF_INVITE_LIST_SQL = `
  SELECT i.id, i.user_id, i.invited_email, i.invited_name, i.role, i.title, i.path, i.capability_denies,
         i.invited_at, i.invited_by, inviter.name AS invited_by_name, i.send_count, i.last_sent_at, i.expires_at,
         i.accepted_at, i.declined_at, i.revoked_at,
         (i.invited_by IS NOT NULL AND (
              EXISTS (SELECT 1 FROM access_code ac WHERE ac.id = i.access_code_id AND ac.partner_user_id = i.invited_by)
           OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = i.invited_by)
           OR (i.role <> 'org_admin' AND EXISTS (SELECT 1 FROM org_staff s WHERE s.access_code_id = i.access_code_id
                                                    AND s.user_id = i.invited_by AND s.role = 'org_admin')))) AS inviter_can_invite
    FROM org_staff_invite i
    LEFT JOIN users inviter ON inviter.id = i.invited_by
   WHERE i.access_code_id = $1::uuid
   ORDER BY (i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL) DESC, i.invited_at DESC
   LIMIT 200`;

function toRecord(r: InviteRow, now: Date): StaffInviteRecord {
  const status = staffInviteStatus({
    path: r.path, sendCount: Number(r.send_count) || 0, expiresAt: r.expires_at,
    acceptedAt: r.accepted_at, declinedAt: r.declined_at, revokedAt: r.revoked_at,
  }, now);
  const open = staffInviteIsOpen(status);
  return {
    id: r.id, email: r.invited_email, name: r.invited_name,
    role: r.role === "org_admin" ? "org_admin" : "staff", title: r.title, addedBySupport: r.path === "admin_added",
    volunteer: (r.capability_denies ?? []).length > 0,
    invitedAt: r.invited_at, invitedByName: r.invited_by_name, sendCount: Number(r.send_count) || 0,
    lastSentAt: r.last_sent_at, expiresAt: r.expires_at, status, statusWords: STAFF_INVITE_STATUS_WORDS[status],
    undeliverable: isUndeliverableEmail(r.invited_email),
    canResend: open && r.path !== "admin_added", canRevoke: open,
    userId: r.user_id, path: r.path, invitedBy: r.invited_by, inviterCanInvite: !!r.inviter_can_invite,
  };
}

/**
 * Pure: the organization-facing shape, built field by field (never by
 * spreading the record), so a field added to the record later cannot leak.
 */
export function orgFacingInvite(r: StaffInvite): StaffInvite {
  return {
    id: r.id, email: r.email, name: r.name, role: r.role, title: r.title, addedBySupport: r.addedBySupport,
    volunteer: r.volunteer, invitedAt: r.invitedAt, invitedByName: r.invitedByName, sendCount: r.sendCount,
    lastSentAt: r.lastSentAt, expiresAt: r.expiresAt, status: r.status, statusWords: r.statusWords,
    undeliverable: r.undeliverable, canResend: r.canResend, canRevoke: r.canRevoke,
  };
}

const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;

/** Every staff invitation of one organization, newest open first. */
export async function listStaffInvites(scope: OrgScope, now: Date = new Date()): Promise<StaffInvite[]> {
  const [rows] = await runScoped<[InviteRow[]]>(scope, (sql) => [run(sql)(STAFF_INVITE_LIST_SQL, [scope.orgId])]);
  return (rows ?? []).map((r) => orgFacingInvite(toRecord(r, now)));
}

/** One invitation of this organization, server-side only (never returned to a client as is). */
async function getStaffInviteRecord(scope: OrgScope, inviteId: string, now: Date = new Date()): Promise<StaffInviteRecord | null> {
  const [rows] = await runScoped<[InviteRow[]]>(scope, (sql) => [
    run(sql)(STAFF_INVITE_LIST_SQL.replace("WHERE i.access_code_id = $1::uuid", "WHERE i.access_code_id = $1::uuid AND i.id = $2::uuid"), [scope.orgId, inviteId]),
  ]);
  return rows?.[0] ? toRecord(rows[0], now) : null;
}

/**
 * Record that an email went out (send_count + 1, last_sent_at now) and renew
 * the 14 days. Only an open invitation changes; the guard trigger refuses a
 * closed one.
 */
export async function markStaffInviteSent(scope: OrgScope, inviteId: string, sent: boolean): Promise<boolean> {
  const [rows] = await runScoped<[{ id: string }[]]>(scope, (sql) => [
    run(sql)(
      `UPDATE org_staff_invite
          SET send_count = send_count + CASE WHEN $3::boolean THEN 1 ELSE 0 END,
              last_sent_at = CASE WHEN $3::boolean THEN now() ELSE last_sent_at END,
              expires_at = now() + make_interval(days => $4::int)
        WHERE id = $1::uuid AND access_code_id = $2::uuid
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [inviteId, scope.orgId, sent, STAFF_INVITE_TTL_DAYS]
    ),
  ]).catch(() => [[]] as [{ id: string }[]]);
  return !!rows?.[0];
}

export type StaffInviteActionResult = { ok: true } | { ok: false; error: string };

/**
 * Who may act on an admin's invitation: the owner, or (only when the caller
 * is the platform-admin route, which has checked the second factor) a
 * platform admin. The organization's own routes pass platformAdmin: false, so
 * a platform admin without two-step, acting as an org admin there, is just
 * an org admin (security review should-fix 2).
 */
async function actorMayActOnAdminInvite(orgId: string, actorUserId: string, platformAdmin: boolean): Promise<boolean> {
  const row = await getOne<{ ok: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM access_code a WHERE a.id = $1::uuid AND a.partner_user_id = $2::uuid)
             OR ($3::boolean AND EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = $2::uuid))) AS ok`,
    [orgId, actorUserId, platformAdmin]
  );
  return !!row?.ok;
}

/** How a caller reached these functions. */
export interface StaffInviteCaller {
  /** True only from /api/admin/orgs (requirePlatformAdmin: platform_admin row and a second-factor session). */
  platformAdmin: boolean;
}

/**
 * Revoke an open invitation. Nothing else to undo: nobody is on staff before
 * saying yes, so a revoked invitation simply can no longer be accepted. The
 * shell account (for a new address) stays, as a participant revoke leaves it.
 */
export async function revokeStaffInvite(scope: OrgScope, inviteId: string, caller: StaffInviteCaller): Promise<StaffInviteActionResult> {
  const inv = await getStaffInviteRecord(scope, inviteId);
  if (!inv) return { ok: false, error: "That invitation was not found." };
  if (!inv.canRevoke) return { ok: false, error: `That invitation is already ${inv.statusWords.toLowerCase()}. Nothing changed.` };
  if (inv.role === "org_admin" && !(await actorMayActOnAdminInvite(scope.orgId, scope.userId, caller.platformAdmin))) {
    return { ok: false, error: "Only the owner can revoke an admin's invitation." };
  }
  const [revoked] = await runScoped<[{ id: string }[]]>(scope, (sql) => [
    run(sql)(
      `UPDATE org_staff_invite SET revoked_at = now()
        WHERE id = $1::uuid AND access_code_id = $2::uuid
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [inviteId, scope.orgId]
    ),
  ]).catch(() => [[]] as [{ id: string }[]]);
  if (!revoked?.[0]) return { ok: false, error: "That invitation did not change. Reload and try again." };
  return { ok: true };
}

/** What a route needs to send (or resend) one invitation's email. Server-side only. */
export interface StaffInviteSend {
  inviteId: string;
  userId: string;
  email: string;
  name: string | null;
  role: "org_admin" | "staff";
  volunteer: boolean;
  path: StaffInvitePath;
  undeliverable: boolean;
}

/**
 * Check an invitation can be resent, and return what the email needs. If
 * whoever sent it can no longer invite (they left, or lost the admin role),
 * the person resending becomes the inviter of record, so the invitation can
 * still be accepted (smr_answer_staff_invite re-checks the inviter), and the
 * screen says so. An admin-role invitation can only be taken over by the
 * owner (or a platform admin on the admin route).
 */
export async function prepareStaffInviteResend(scope: OrgScope, inviteId: string, caller: StaffInviteCaller):
  Promise<{ ok: true; send: StaffInviteSend; restamped: boolean } | { ok: false; error: string }> {
  const inv = await getStaffInviteRecord(scope, inviteId);
  if (!inv) return { ok: false, error: "That invitation was not found." };
  if (!inv.canRevoke) return { ok: false, error: `That invitation is already ${inv.statusWords.toLowerCase()}. Nothing was sent.` };
  if (inv.path === "admin_added") return { ok: false, error: "That person was added directly. There is nothing to resend." };
  if (inv.role === "org_admin" && !(await actorMayActOnAdminInvite(scope.orgId, scope.userId, caller.platformAdmin))) {
    return { ok: false, error: "Only the owner can resend an admin's invitation." };
  }
  let restamped = false;
  if (!inv.inviterCanInvite && inv.invitedBy !== scope.userId) {
    const [rows] = await runScoped<[{ id: string }[]]>(scope, (sql) => [
      run(sql)(
        `UPDATE org_staff_invite SET invited_by = $3::uuid
          WHERE id = $1::uuid AND access_code_id = $2::uuid
            AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
          RETURNING id`,
        [inviteId, scope.orgId, scope.userId]
      ),
    ]).catch(() => [[]] as [{ id: string }[]]);
    if (!rows?.[0]) return { ok: false, error: "The person who sent this can no longer add staff, and it could not be moved to you. Revoke it and send a new one." };
    restamped = true;
  }
  return {
    ok: true,
    restamped,
    send: { inviteId: inv.id, userId: inv.userId, email: inv.email, name: inv.name, role: inv.role, volunteer: inv.volunteer, path: inv.path, undeliverable: inv.undeliverable },
  };
}

/* ------------------------------------------------------------------ inviting -- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StaffInviteRoleChoice = "org_admin" | "staff" | StaffPreset;

/** Pure: the shape of an invitation request. */
export function validateStaffInviteInput(raw: { name?: unknown; email?: unknown; role?: unknown; title?: unknown }):
  { ok: true; value: { name: string; email: string; role: "org_admin" | "staff"; preset: StaffPreset | null; title: string | null } } | { ok: false; error: string } {
  const email = String(raw.email ?? "").trim().toLowerCase();
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  const roleRaw = String(raw.role ?? "staff");
  const preset: StaffPreset | null = isStaffPreset(roleRaw) ? roleRaw : null;
  const role: "org_admin" | "staff" = roleRaw === "org_admin" ? "org_admin" : "staff";
  if (roleRaw !== "org_admin" && roleRaw !== "staff" && !preset) return { ok: false, error: "Pick a role." };
  const titleRaw = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!name || name.length > 200) return { ok: false, error: "A name is needed (up to 200 characters)." };
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Enter a valid email address." };
  if (titleRaw.length > 120) return { ok: false, error: "Keep the title under 120 characters." };
  return { ok: true, value: { name, email, role, preset, title: titleRaw || (preset ? STAFF_PRESETS[preset].label : null) } };
}

/** The denies an invitation stores for a preset (only capabilities the role would otherwise give). */
export function inviteDeniesFor(preset: StaffPreset | null): string[] {
  if (!preset) return [];
  return presetOverrideWrites(preset).filter((w) => w.effect === "deny").map((w) => w.capability);
}

/**
 * SQL: staff places taken = staff rows plus open, unexpired invitations.
 * Every invitation, new address or existing account, holds one place until it
 * is answered, revoked or expires, so the number moves the same way for both
 * (security review B1).
 */
export const STAFF_PLACES_SQL = `
  SELECT (SELECT COUNT(*)::int FROM org_staff WHERE access_code_id = $1::uuid)
       + (SELECT COUNT(*)::int FROM org_staff_invite i
           WHERE i.access_code_id = $1::uuid AND i.path IN ('new_account', 'existing_account')
             AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) AS n,
         (SELECT max_staff FROM access_code WHERE id = $1::uuid) AS max,
         (SELECT is_active FROM access_code WHERE id = $1::uuid) AS active`;

export async function staffPlaces(scope: OrgScope): Promise<{ n: number; max: number; active: boolean }> {
  const [rows] = await runScoped<[{ n: number; max: number; active: boolean }[]]>(scope, (sql) => [run(sql)(STAFF_PLACES_SQL, [scope.orgId])]);
  return { n: Number(rows?.[0]?.n ?? 0), max: Number(rows?.[0]?.max ?? 0), active: rows?.[0]?.active !== false };
}

export type InviteOutcome =
  | { ok: true; inviteId: string; userId: string; email: string; name: string; path: StaffInvitePath; undeliverable: boolean; renewed: boolean }
  | { ok: false; error: string };

/**
 * An existing account, invited by the owner or an admin: write the open
 * invitation and nothing else. If one is already open, it is renewed (the
 * route then resends), so pressing "Send" twice never makes two.
 */
export async function inviteExistingAccount(scope: OrgScope, input: {
  userId: string; email: string; name: string; role: "org_admin" | "staff"; title: string | null; denies: string[];
  /** Set when every staff place is taken: a new invitation is refused with it (an open one is still renewed). */
  fullReason?: string | null;
}): Promise<InviteOutcome> {
  const [open] = await runScoped<[{ id: string; path: StaffInvitePath }[]]>(scope, (sql) => [
    run(sql)(
      `SELECT id, path FROM org_staff_invite WHERE access_code_id = $1::uuid AND user_id = $2::uuid
          AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL`,
      [scope.orgId, input.userId]
    ),
  ]);
  if (open?.[0]) {
    // Pressing Send again renews the one open invitation (new address or not):
    // the route resends it with the email its path needs. Same answer either way.
    return { ok: true, inviteId: open[0].id, userId: input.userId, email: input.email, name: input.name, path: open[0].path, undeliverable: isUndeliverableEmail(input.email), renewed: true };
  }
  if (input.fullReason) return { ok: false, error: input.fullReason };
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scope, (sql) => [
      run(sql)(
        `INSERT INTO org_staff_invite (access_code_id, user_id, invited_email, invited_name, role, title, capability_denies, path, send_count)
         SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7::text[], 'existing_account', 0
          WHERE EXISTS (SELECT 1 FROM access_code WHERE id = $1::uuid AND is_active = true)
         RETURNING id`,
        [scope.orgId, input.userId, input.email, input.name, input.role, input.title, input.denies]
      ),
    ]);
    if (!rows?.[0]) return { ok: false, error: "That organization is closed. Nothing was saved." };
    return { ok: true, inviteId: rows[0].id, userId: input.userId, email: input.email, name: input.name, path: "existing_account", undeliverable: isUndeliverableEmail(input.email), renewed: false };
  } catch (err) {
    console.error("staff invite (existing account) failed:", (err as Error)?.message || err);
    return { ok: false, error: "The invitation was not saved. Try again." };
  }
}

/** Is this account already on this organization's staff, or its owner? */
export async function alreadyOnStaff(scope: OrgScope, userId: string): Promise<boolean> {
  const [rows] = await runScoped<[{ n: number }[]]>(scope, (sql) => [
    run(sql)(
      `SELECT ((SELECT COUNT(*) FROM org_staff WHERE access_code_id = $1::uuid AND user_id = $2::uuid)
             + (SELECT COUNT(*) FROM access_code WHERE id = $1::uuid AND partner_user_id = $2::uuid))::int AS n`,
      [scope.orgId, userId]
    ),
  ]);
  return Number(rows?.[0]?.n ?? 0) > 0;
}

/* --------------------------------------------------------- platform admin -- */

/**
 * Admin > Organizations > Add staff. A platform admin attaches an EXISTING
 * account directly (the support path: no acceptance step, recorded as
 * admin_added with this admin as the actor), or invites a NEW address the
 * same way the owner does. Roles: admin or staff. Volunteer settings are the
 * organization's choice and are set on its Team & access page.
 *
 * The caller (the route) has checked requirePlatformAdmin. The statements
 * check it again from platform_admin, and the org_staff_invite guard trigger
 * refuses admin_added for anyone else.
 */
export async function adminAddStaff(orgId: string, adminUserId: string, raw: { name?: unknown; email?: unknown; role?: unknown; title?: unknown }): Promise<InviteOutcome> {
  const v = validateStaffInviteInput({ ...raw, role: raw.role === "org_admin" ? "org_admin" : "staff" });
  if (!v.ok) return v;
  const { name, email, role, title } = v.value;
  const scope: OrgScope = { orgId, userId: adminUserId, role: "org_admin" };
  const places = await staffPlaces(scope);
  if (!places.active) return { ok: false, error: "This organization is closed. Reopen it before adding staff." };

  const existing = await getOne<{ id: string; pending: boolean }>(
    `SELECT u.id, (u."emailVerified" IS NULL AND u.password_hash IS NULL
                   AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id)) AS pending
       FROM users u WHERE u.email = $1`,
    [email]
  );
  if (existing) {
    if (await alreadyOnStaff(scope, existing.id)) return { ok: false, error: "That account is already on this organization's team (or owns it)." };
    if (places.n >= places.max) return { ok: false, error: `This organization has ${places.n} of ${places.max} staff places in use. Raise the staff places first.` };
    try {
      const out = await runScoped<[{ id: string }[], { id: string }[]]>(scope, (sql) => [
        run(sql)(
          `INSERT INTO org_staff (access_code_id, user_id, role, title, created_by)
           SELECT $1::uuid, $2::uuid, $3, $4, $5::uuid
            WHERE EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = $5::uuid)
              AND EXISTS (SELECT 1 FROM access_code WHERE id = $1::uuid AND is_active = true)
              AND (SELECT COUNT(*) FROM org_staff c WHERE c.access_code_id = $1::uuid) < (SELECT max_staff FROM access_code WHERE id = $1::uuid)
           RETURNING id`,
          [orgId, existing.id, role, title, adminUserId]
        ),
        run(sql)(
          `INSERT INTO org_staff_invite (access_code_id, user_id, invited_email, invited_name, role, title, path, send_count)
           SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, 'admin_added', 0
            WHERE EXISTS (SELECT 1 FROM org_staff WHERE access_code_id = $1::uuid AND user_id = $2::uuid)
           RETURNING id`,
          [orgId, existing.id, email, name, role, title]
        ),
      ]);
      if (!out[0]?.[0]) return { ok: false, error: "They were not added. The organization may be full or closed. Nothing was saved." };
      return { ok: true, inviteId: out[1]?.[0]?.id ?? "", userId: existing.id, email, name, path: "admin_added", undeliverable: isUndeliverableEmail(email), renewed: false };
    } catch (err) {
      console.error("adminAddStaff failed:", (err as Error)?.message || err);
      return { ok: false, error: "They were not added. Nothing was saved. Try again." };
    }
  }
  if (places.n >= places.max) return { ok: false, error: `This organization has ${places.n} of ${places.max} staff places in use. Raise the staff places first.` };
  return createNewAccountInvite(scope, { name, email, role, title, preset: null });
}

/**
 * A new address: a shell account (so the emailed sign-in link works) and the
 * invitation row. NO staff row and NO capability writes: the person accepts
 * on /dashboard/invites, and smr_answer_staff_invite writes the staff row
 * with the preset's restrictions (capability_denies) in one transaction
 * (security review B2). Shared by the owner path and the admin path.
 */
export async function createNewAccountInvite(scope: OrgScope, input: {
  name: string; email: string; role: "org_admin" | "staff"; title: string | null; preset: StaffPreset | null;
}): Promise<InviteOutcome> {
  const made = await query<{ id: string }>(
    `INSERT INTO users (name, email, tier) VALUES ($1, $2, 'partner') ON CONFLICT (email) DO NOTHING RETURNING id`,
    [input.name, input.email]
  );
  if (!made[0]) return { ok: false, error: "The invitation was not saved. Try again." };
  const userId = made[0].id;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scope, (sql) => [
      run(sql)(
        `INSERT INTO org_staff_invite (access_code_id, user_id, invited_email, invited_name, role, title, capability_denies, path, send_count)
         SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7::text[], 'new_account', 0
          WHERE EXISTS (SELECT 1 FROM access_code WHERE id = $1::uuid AND is_active = true)
         RETURNING id`,
        [scope.orgId, userId, input.email, input.name, input.role, input.title, inviteDeniesFor(input.preset)]
      ),
    ]);
    if (!rows?.[0]) {
      await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {}); // just created here, safe to remove
      return { ok: false, error: "That organization is closed. Nothing was saved." };
    }
    return { ok: true, inviteId: rows[0].id, userId, email: input.email, name: input.name, path: "new_account", undeliverable: isUndeliverableEmail(input.email), renewed: false };
  } catch (err) {
    console.error("staff invite (new account) failed:", (err as Error)?.message || err);
    await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    return { ok: false, error: "The invitation was not saved. Try again." };
  }
}

/** The scope a resolved actor writes under. */
export const scopeOfActor = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });

/* ------------------------------------------------------------ the invitee -- */

export interface MyStaffInvite {
  id: string;
  orgName: string;
  role: "org_admin" | "staff";
  title: string | null;
  invitedByName: string | null;
  expiresAt: string;
  expired: boolean;
}

/** Open invitations for the signed-in person (their own rows, RLS self-read). */
export async function myStaffInvites(userId: string, now: Date = new Date()): Promise<MyStaffInvite[]> {
  const [rows] = await runAsUser<[{ id: string; org_name: string; role: string; title: string | null; invited_by_name: string | null; expires_at: string; org_active: boolean }[]]>(userId, (sql) => [
    run(sql)(
      `SELECT i.id, ac.partner_name AS org_name, i.role, i.title, inviter.name AS invited_by_name, i.expires_at, ac.is_active AS org_active
         FROM org_staff_invite i
         JOIN access_code ac ON ac.id = i.access_code_id
         LEFT JOIN users inviter ON inviter.id = i.invited_by
        WHERE i.user_id = $1::uuid AND i.path IN ('new_account', 'existing_account')
          AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL
        ORDER BY i.invited_at DESC LIMIT 20`,
      [userId]
    ),
  ]);
  return (rows ?? []).filter((r) => r.org_active).map((r) => ({
    id: r.id, orgName: r.org_name, role: r.role === "org_admin" ? "org_admin" : "staff", title: r.title,
    invitedByName: r.invited_by_name, expiresAt: r.expires_at, expired: new Date(r.expires_at).getTime() <= now.getTime(),
  }));
}

/** What each answer from smr_answer_staff_invite means, in plain words. */
export const ANSWER_WORDS: Record<string, string> = {
  ok: "You are on the team. Your organization's workspace is in the menu.",
  declined: "You said no. Nothing changed.",
  not_found: "That invitation was not found.",
  revoked: "That invitation was withdrawn by the organization.",
  answered: "You already answered that invitation.",
  expired: "That invitation expired. Ask the organization to send it again.",
  closed: "That organization is closed right now.",
  inviter_gone: "The person who invited you can no longer add staff. Ask the organization to send a new invitation.",
  full: "The organization has no staff places left. Ask them to make room, then try again.",
  refused: "That did not work. Sign in again and retry.",
};

/** Accept or decline one of my invitations. The database decides who "me" is. */
export async function answerStaffInvite(userId: string, inviteId: string, accept: boolean): Promise<{ ok: boolean; result: string; message: string }> {
  try {
    const [rows] = await runAsUser<[{ r: string }[]]>(userId, (sql) => [
      run(sql)(`SELECT smr_answer_staff_invite($1::uuid, $2::boolean) AS r`, [inviteId, accept]),
    ]);
    const result = rows?.[0]?.r ?? "refused";
    return { ok: result === "ok" || result === "declined", result, message: ANSWER_WORDS[result] ?? ANSWER_WORDS.refused };
  } catch (err) {
    console.error("answerStaffInvite failed:", (err as Error)?.message || err);
    return { ok: false, result: "error", message: "That did not save. Try again." };
  }
}
