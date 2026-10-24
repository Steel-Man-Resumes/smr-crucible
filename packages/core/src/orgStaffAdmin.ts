/**
 * Adding, re-roling, and removing org staff.
 *
 * This did not exist. `org_staff` had no write path anywhere in the product --
 * the only things that ever inserted into it were three one-off seed scripts,
 * which means every org's team was set up by hand and could not be changed
 * without a developer. The console cannot be real without this.
 *
 * It is also the highest-risk write in the application, because a row here
 * grants a person access to other people's case data. So the rules are strict:
 *
 *   MEMBERSHIP CHECKS LIVE IN THE STATEMENT. Each write sources its values from
 *   a SELECT whose WHERE clause carries the membership predicate, so a write
 *   that is not permitted affects zero rows rather than relying on a prior `if`.
 *
 *   TO BE PRECISE ABOUT WHAT THAT IS AND IS NOT: the CALLER's authority is
 *   checked earlier, at the route, by requireOrgCapability. The "already serves
 *   another org" check is a separate query, and removal plus caseload release
 *   are separate writes. So this is not one atomic authorization -- an earlier
 *   commit message said it was, and that was overstated. What it is: the
 *   membership predicate cannot be skipped or raced past.
 *
 *   NOBODY CAN ESCALATE THEMSELVES. A staff member cannot make themselves an
 *   org admin, and nobody can change or remove the owner, because ownership
 *   lives on access_code.partner_user_id and nothing here touches that table.
 *
 *   EVERY WRITE RETURNS WHAT IT DID. A caller can tell "you were not allowed"
 *   from "it worked", which is exactly what a silent zero-row write hides.
 */

import { getOne, query, runScoped, type OrgScope } from "./db";

/**
 * query(), with the organization scope set so row-level policies pass.
 *
 * org_staff and client_staff_assignment are RLS-protected, so an unscoped
 * write here affects ZERO rows rather than failing loudly -- safe, but
 * silently broken, which is its own kind of bad. Every statement in this file
 * goes through here.
 */
async function scopedQuery<T>(
  orgId: string,
  sql: string,
  params: unknown[],
  actorUserId = ""
): Promise<T[]> {
  const scope: OrgScope = { orgId, userId: actorUserId, role: "org_admin" };
  const out = await runScoped<unknown[][]>(scope, (c) => [
    (c as unknown as (s: string, p: unknown[]) => unknown)(sql, params),
  ]);
  return (out[0] ?? []) as T[];
}
import type { OrgStaffRole } from "./authz/capabilities";

export interface OrgStaffWriteResult {
  ok: boolean;
  /** Present when ok is false: safe to show the user. */
  reason?: string;
}

/** The roles a row in org_staff may actually hold. 'owner' is not one of them. */
export type AssignableStaffRole = Exclude<OrgStaffRole, "owner">;

function isAssignableRole(role: string): role is AssignableStaffRole {
  return role === "org_admin" || role === "staff";
}

/**
 * ONLY THE OWNER MAKES, CHANGES OR REMOVES AN ADMIN.
 *
 * The screen showed the role switch to owners only, inviteOrgStaff refused an
 * admin creating an admin, and smr_set_capability_override returns owner_only
 * for changes to an admin -- but add_staff, set_staff_role and remove_staff
 * needed only org.staff.manage, which admins hold. So one admin could promote
 * a friend or remove a fellow admin through the API (R3 review S1).
 *
 * Pure, so the rule is testable; the same rule is ALSO in each statement's
 * WHERE clause, where the owner is looked up from access_code rather than
 * taken from the caller, so a wrong actor role passed in cannot widen it.
 */
export function staffWriteNeedsOwner(input: {
  action: "add" | "set_role" | "remove";
  /** The target's role in org_staff today, or null if they have no row. */
  targetCurrentRole: string | null;
  /** The role being written (add and set_role). */
  newRole?: string | null;
}): boolean {
  if (input.targetCurrentRole === "org_admin") return true;
  if (input.action !== "remove" && input.newRole === "org_admin") return true;
  return false;
}

const OWNER_ONLY_REASON = "Only the owner can add, change or remove an admin.";

/** SQL: the actor ($actor) owns org ($org), read from access_code, never from the caller. */
const ACTOR_IS_OWNER = (org: string, actor: string) =>
  `EXISTS (SELECT 1 FROM access_code ac_o WHERE ac_o.id = ${org} AND ac_o.partner_user_id = ${actor}::uuid)`;

/**
 * SQL for the platform-admin support path (/api/admin/orgs only): the actor
 * owns the org OR is a row in platform_admin, read from the database. The org
 * console (/api/partner/org) never uses this: viewing an org is not owning it.
 */
const ACTOR_IS_OWNER_OR_PLATFORM_ADMIN = (org: string, actor: string) =>
  `(${ACTOR_IS_OWNER(org, actor)} OR EXISTS (SELECT 1 FROM platform_admin pa WHERE pa.user_id = ${actor}::uuid))`;

/** Which owner predicate a write uses. */
export type StaffWriteAuthority = "owner" | "owner_or_platform_admin";
const ownerSql = (authority: StaffWriteAuthority | undefined, org: string, actor: string) =>
  authority === "owner_or_platform_admin" ? ACTOR_IS_OWNER_OR_PLATFORM_ADMIN(org, actor) : ACTOR_IS_OWNER(org, actor);

async function currentStaffRole(orgId: string, userId: string, actorUserId: string): Promise<string | null> {
  const rows = await scopedQuery<{ role: string }>(
    orgId,
    `SELECT role FROM org_staff WHERE access_code_id = $1 AND user_id = $2`,
    [orgId, userId],
    actorUserId
  );
  return rows[0]?.role ?? null;
}

async function actorOwns(orgId: string, actorUserId: string, authority?: StaffWriteAuthority): Promise<boolean> {
  if (!actorUserId) return false;
  const row = await getOne<{ ok: boolean }>(
    `SELECT ${ownerSql(authority, "$1::uuid", "$2")} AS ok`,
    [orgId, actorUserId]
  );
  return !!row?.ok;
}

/**
 * Add an existing account to an organization's staff.
 *
 * The person must already have an account -- inviting a new one is a different
 * flow with its own email and seat accounting (createOrgInvite). This is for
 * "make this existing user part of my team".
 */
export async function addOrgStaff(params: {
  orgId: string;
  userId: string;
  role: AssignableStaffRole;
  title?: string | null;
  addedBy: string;
}): Promise<OrgStaffWriteResult> {
  const { orgId, userId, role, title = null, addedBy } = params;

  if (!isAssignableRole(role)) {
    return { ok: false, reason: "That is not a role that can be assigned." };
  }

  // A person already serving another organization must not be added to a
  // second one silently. Staff membership decides whose case data someone can
  // read, and quietly spanning two orgs is the exact shape of a cross-org leak.
  // THE CROSS-ORG EXCLUSIVITY CHECK IS GONE, and pretending otherwise would
  // be worse than losing it. It asked for rows where access_code_id <> this
  // org, on a connection RLS restricts to rows where access_code_id = this
  // org. That is provably always zero -- a check that always passes, which is
  // not a check. (Found in review; my own comment claiming it still caught
  // same-team cases was also wrong: the inequality excludes this team.)
  //
  // WHAT STILL HOLDS: the person must already have a relationship with THIS
  // organization, and the row written can only belong to it. WHAT NO LONGER
  // HOLDS: somebody serving another org can now be added here too. Enforcing
  // one-org-per-staff-member needs a database invariant -- a partial unique
  // index on org_staff(user_id) -- not an application read that RLS forbids.
  // Tracked, not silently dropped.

  // KNOWING A USER ID IS NOT AUTHORIZATION TO RECRUIT SOMEONE.
  //
  // This originally admitted any existing account. Since the roster then
  // returns each staff member's NAME and EMAIL, an org admin who guessed or
  // obtained another org's participant id could add them and read their
  // identity back -- the same disclosure the assignment fix closed, through a
  // different door. (Found in review, 2026-09-19.)
  //
  // So the person must already have a relationship with THIS organization:
  // they redeemed its access code, or they hold a pending invite to it.
  // Anything else is a stranger, and a stranger joins by invitation.
  // Owner-only for anything that creates or changes an admin, including an
  // ON CONFLICT re-role of someone already on staff. The friendly refusal is
  // decided here; the binding one is in the statement below.
  const targetRole = await currentStaffRole(orgId, userId, addedBy);
  if (staffWriteNeedsOwner({ action: "add", targetCurrentRole: targetRole, newRole: role }) && !(await actorOwns(orgId, addedBy))) {
    return { ok: false, reason: OWNER_ONLY_REASON };
  }
  if (!targetRole) {
    const cap = await scopedQuery<{ n: number; max: number }>(
      orgId,
      `SELECT (SELECT COUNT(*)::int FROM org_staff WHERE access_code_id = $1) AS n,
              (SELECT max_staff FROM access_code WHERE id = $1) AS max`,
      [orgId],
      addedBy
    );
    if (cap[0] && cap[0].n >= cap[0].max) {
      return { ok: false, reason: `Your organization has ${cap[0].n} of ${cap[0].max} staff places in use. Remove someone from the team, or ask Steel Man Resumes for more places.` };
    }
  }

  const written = await scopedQuery<{ id: string }>(
    orgId,
    `INSERT INTO org_staff (access_code_id, user_id, role, title, created_by)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM access_code WHERE id = $1 AND is_active = true)
        AND ($3 <> 'org_admin' OR ${ACTOR_IS_OWNER("$1", "$5")})
        -- Staff cap (097): a NEW staff row needs a free staff place; a
        -- re-role of someone already on staff does not.
        AND (EXISTS (SELECT 1 FROM org_staff os_e WHERE os_e.access_code_id = $1 AND os_e.user_id = $2)
             OR (SELECT COUNT(*) FROM org_staff os_c WHERE os_c.access_code_id = $1) < (SELECT ac_c.max_staff FROM access_code ac_c WHERE ac_c.id = $1))
        AND (
          EXISTS (
            SELECT 1 FROM access_code_redemption acr
             WHERE acr.access_code_id = $1 AND acr.user_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM org_staff os
             WHERE os.access_code_id = $1 AND os.user_id = $2
          )
        )
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, title = EXCLUDED.title
      WHERE (org_staff.role <> 'org_admin' AND EXCLUDED.role <> 'org_admin') OR ${ACTOR_IS_OWNER("$1", "$5")}
     RETURNING id`,
    [orgId, userId, role, title, addedBy],
    addedBy
  );

  return written.length > 0
    ? { ok: true }
    : {
        ok: false,
        reason:
          "That person has no connection to this organization yet. Invite them with your organization's code first. An account can only be added to a team it already belongs to.",
      };
}

/**
 * Change a staff member's role within the organization they already belong to.
 *
 * Scoped by orgId in the WHERE clause, so an admin at org A cannot re-role
 * somebody at org B even by naming their user id.
 */
export async function setOrgStaffRole(params: {
  orgId: string;
  userId: string;
  role: AssignableStaffRole;
  actorUserId: string;
  /** Default "owner". Only the platform-admin support route passes the wider one. */
  authority?: StaffWriteAuthority;
}): Promise<OrgStaffWriteResult> {
  const { orgId, userId, role, actorUserId, authority } = params;

  if (!isAssignableRole(role)) {
    return { ok: false, reason: "That is not a role that can be assigned." };
  }
  if (userId === actorUserId) {
    // Self-promotion is the classic escalation, and there is no legitimate use
    // for it: an admin already has every capability the role grants.
    return { ok: false, reason: "You cannot change your own role." };
  }

  const targetRole = await currentStaffRole(orgId, userId, actorUserId);
  if (targetRole && staffWriteNeedsOwner({ action: "set_role", targetCurrentRole: targetRole, newRole: role }) && !(await actorOwns(orgId, actorUserId, authority))) {
    return { ok: false, reason: OWNER_ONLY_REASON };
  }

  // Every role change here touches an admin (promote to, or demote from), so
  // the owner predicate covers both directions; a staff-to-staff write is a
  // no-op that needs no owner.
  const written = await scopedQuery<{ user_id: string }>(
    orgId,
    `UPDATE org_staff SET role = $3
      WHERE access_code_id = $1 AND user_id = $2
        AND ((role <> 'org_admin' AND $3 <> 'org_admin') OR ${ownerSql(authority, "$1", "$4")})
      RETURNING user_id`,
    [orgId, userId, role, actorUserId],
    actorUserId
  );

  return written.length > 0
    ? { ok: true }
    : { ok: false, reason: "That person is not on your staff." };
}

/**
 * Remove someone from an organization's staff, and release their caseload.
 *
 * Their client assignments are cleared in the same breath. Leaving a departed
 * staff member's name attached to live participants is how a caseload becomes
 * nobody's job without anyone noticing -- and the console's "where to start
 * today" strip surfaces unassigned people precisely so that is visible.
 *
 * Removing staff does not touch the person's own account or their own data.
 */
export async function removeOrgStaff(params: {
  orgId: string;
  userId: string;
  actorUserId: string;
  /** Default "owner". Only the platform-admin support route passes the wider one. */
  authority?: StaffWriteAuthority;
}): Promise<OrgStaffWriteResult & { releasedClients?: number }> {
  const { orgId, userId, actorUserId, authority } = params;

  if (userId === actorUserId) {
    return { ok: false, reason: "You cannot remove yourself from your own organization." };
  }

  const owner = await getOne<{ id: string }>(
    `SELECT id FROM access_code WHERE id = $1 AND partner_user_id = $2`,
    [orgId, userId]
  );
  if (owner) {
    return { ok: false, reason: "The organization's owner cannot be removed here." };
  }

  const targetRole = await currentStaffRole(orgId, userId, actorUserId);
  if (targetRole && staffWriteNeedsOwner({ action: "remove", targetCurrentRole: targetRole }) && !(await actorOwns(orgId, actorUserId, authority))) {
    return { ok: false, reason: OWNER_ONLY_REASON };
  }

  const removed = await scopedQuery<{ user_id: string }>(
    orgId,
    `DELETE FROM org_staff
      WHERE access_code_id = $1 AND user_id = $2
        AND (role <> 'org_admin' OR ${ownerSql(authority, "$1", "$3")})
      RETURNING user_id`,
    [orgId, userId, actorUserId],
    actorUserId
  );
  if (removed.length === 0) {
    return { ok: false, reason: "That person is not on your staff." };
  }

  const released = await scopedQuery<{ client_user_id: string }>(
    orgId,
    `DELETE FROM client_staff_assignment
      WHERE access_code_id = $1 AND staff_user_id = $2
      RETURNING client_user_id`,
    [orgId, userId],
    actorUserId
  );

  return { ok: true, releasedClients: released.length };
}
