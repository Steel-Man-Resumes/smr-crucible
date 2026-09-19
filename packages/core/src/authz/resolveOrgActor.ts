/**
 * Resolve who someone is inside an organization, per request, from the database.
 *
 * NOT FROM THE TOKEN, and that is the whole point. If org identity or
 * capabilities rode on the JWT, then removing a staff member would leave them
 * with working access until their token expired -- which is exactly the window
 * you cannot have in a tool where "who can read this participant's file" is the
 * product promise. Resolving per request costs two small queries and makes a
 * revocation take effect on the next click.
 *
 * The org id is likewise never taken from the request. A caller does not get to
 * say which organization they are acting as; membership says it for them. The
 * one exception is a platform admin naming a specific org explicitly, which is
 * an override and is marked as one.
 */

import { getOne, query } from "../db";
import {
  computeOrgCapabilities,
  cohortReach,
  type CohortReach,
  type OrgCapability,
  type OrgStaffRole,
} from "./capabilities";

export interface OrgActor {
  userId: string;
  /** The access code that IS the organization, in today's schema. */
  orgId: string;
  orgName: string;
  role: OrgStaffRole;
  capabilities: ReadonlySet<OrgCapability>;
  /** How much of the cohort this person may see. */
  reach: CohortReach;
  /** True when a platform admin is acting on an org they are not a member of. */
  viaPlatformAdmin: boolean;
}

/**
 * Membership lookup. Owner wins over staff, because owning the code is the
 * stronger claim and `getOrgContext` already resolves it that way.
 *
 * NOTE, and it is a real limitation rather than an oversight: a person who
 * belongs to more than one organization is pinned to their earliest one, the
 * same way `getOrgContext` pins them. Making that a choice needs an org
 * switcher and an explicit orgId parameter, which is a product decision, not
 * something to guess at inside an authorization function.
 */
async function findMembership(
  userId: string,
  orgId?: string
): Promise<{ orgId: string; orgName: string; role: OrgStaffRole } | null> {
  const owned = await getOne<{ id: string; partner_name: string }>(
    `SELECT id, partner_name FROM access_code
      WHERE partner_user_id = $1 AND is_active = true
        AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY created_at ASC LIMIT 1`,
    [userId, orgId ?? null]
  );
  if (owned) return { orgId: owned.id, orgName: owned.partner_name, role: "owner" };

  const staff = await getOne<{ access_code_id: string; role: string; partner_name: string }>(
    `SELECT os.access_code_id, os.role, ac.partner_name
       FROM org_staff os
       JOIN access_code ac ON ac.id = os.access_code_id
      WHERE os.user_id = $1 AND ac.is_active = true
        AND ($2::uuid IS NULL OR os.access_code_id = $2::uuid)
      ORDER BY os.created_at ASC LIMIT 1`,
    [userId, orgId ?? null]
  );
  if (!staff) return null;

  // org_staff.role is constrained to 'org_admin' | 'staff' in the schema, but
  // this function must not trust that a row matches the constraint it was
  // written under. An unrecognized role resolves to the narrowest one.
  const role: OrgStaffRole = staff.role === "org_admin" ? "org_admin" : "staff";
  return { orgId: staff.access_code_id, orgName: staff.partner_name, role };
}

/**
 * Resolve the acting identity, or null when this person belongs to no org.
 *
 * `isPlatformAdmin` plus an explicit `orgId` is the only way to act on an org
 * you are not a member of, and the result is flagged `viaPlatformAdmin` so the
 * caller can audit it rather than discovering it later.
 */
export async function resolveOrgActor(
  userId: string,
  opts: { isPlatformAdmin?: boolean; orgId?: string } = {}
): Promise<OrgActor | null> {
  const membership = await findMembership(userId, opts.orgId);

  let resolved: { orgId: string; orgName: string; role: OrgStaffRole } | null = membership;
  let viaPlatformAdmin = false;

  if (!resolved && opts.isPlatformAdmin && opts.orgId) {
    const org = await getOne<{ id: string; partner_name: string }>(
      `SELECT id, partner_name FROM access_code WHERE id = $1`,
      [opts.orgId]
    );
    if (!org) return null;
    resolved = { orgId: org.id, orgName: org.partner_name, role: "owner" };
    viaPlatformAdmin = true;
  }

  if (!resolved) return null;

  // Per-user exceptions are read from the database and filtered against the
  // code vocabulary inside computeOrgCapabilities, so a stale or tampered row
  // cannot grant a power this build does not define.
  const overrides = await query<{ capability: string; effect: string }>(
    `SELECT capability, effect FROM org_capability_override
      WHERE org_id = $1 AND user_id = $2`,
    [resolved.orgId, userId]
  ).catch(() => []); // table not migrated yet: no overrides, not an outage

  const capabilities = computeOrgCapabilities(
    resolved.role,
    overrides.filter((o) => o.effect === "grant").map((o) => o.capability),
    overrides.filter((o) => o.effect === "deny").map((o) => o.capability)
  );

  return {
    userId,
    orgId: resolved.orgId,
    orgName: resolved.orgName,
    role: resolved.role,
    capabilities,
    reach: cohortReach(capabilities),
    viaPlatformAdmin,
  };
}
