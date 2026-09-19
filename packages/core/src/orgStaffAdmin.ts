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
 *   AUTHORIZATION LIVES IN THE STATEMENT. Every write sources its values from a
 *   SELECT whose WHERE clause IS the authorization check, so there is no window
 *   between deciding and doing, and a write that is not permitted affects zero
 *   rows rather than being prevented by a prior `if`. A separate check-then-act
 *   is a race; this is not.
 *
 *   NOBODY CAN ESCALATE THEMSELVES. A staff member cannot make themselves an
 *   org admin, and nobody can change or remove the owner, because ownership
 *   lives on access_code.partner_user_id and nothing here touches that table.
 *
 *   EVERY WRITE RETURNS WHAT IT DID. A caller can tell "you were not allowed"
 *   from "it worked", which is exactly what a silent zero-row write hides.
 */

import { getOne, query } from "./db";
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
  const elsewhere = await getOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM org_staff
      WHERE user_id = $1 AND access_code_id <> $2`,
    [userId, orgId]
  );
  if (Number(elsewhere?.n ?? 0) > 0) {
    return {
      ok: false,
      reason: "That person is already on staff at another organization.",
    };
  }

  const written = await query<{ id: string }>(
    `INSERT INTO org_staff (access_code_id, user_id, role, title, created_by)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM users WHERE id = $2)
        AND EXISTS (SELECT 1 FROM access_code WHERE id = $1 AND is_active = true)
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, title = EXCLUDED.title
     RETURNING id`,
    [orgId, userId, role, title, addedBy]
  );

  return written.length > 0
    ? { ok: true }
    : { ok: false, reason: "That account does not exist, or the organization is inactive." };
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
}): Promise<OrgStaffWriteResult> {
  const { orgId, userId, role, actorUserId } = params;

  if (!isAssignableRole(role)) {
    return { ok: false, reason: "That is not a role that can be assigned." };
  }
  if (userId === actorUserId) {
    // Self-promotion is the classic escalation, and there is no legitimate use
    // for it: an admin already has every capability the role grants.
    return { ok: false, reason: "You cannot change your own role." };
  }

  const written = await query<{ user_id: string }>(
    `UPDATE org_staff SET role = $3
      WHERE access_code_id = $1 AND user_id = $2
      RETURNING user_id`,
    [orgId, userId, role]
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
}): Promise<OrgStaffWriteResult & { releasedClients?: number }> {
  const { orgId, userId, actorUserId } = params;

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

  const removed = await query<{ user_id: string }>(
    `DELETE FROM org_staff
      WHERE access_code_id = $1 AND user_id = $2
      RETURNING user_id`,
    [orgId, userId]
  );
  if (removed.length === 0) {
    return { ok: false, reason: "That person is not on your staff." };
  }

  const released = await query<{ client_user_id: string }>(
    `DELETE FROM client_staff_assignment
      WHERE access_code_id = $1 AND staff_user_id = $2
      RETURNING client_user_id`,
    [orgId, userId]
  );

  return { ok: true, releasedClients: released.length };
}
