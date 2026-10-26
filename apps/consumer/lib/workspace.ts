/**
 * Which workspace a signed-in person gets: the ONE place that decides it
 * (house lane L2, 2026-10-26). Pure, so the shell, the /dashboard landing and
 * /api/user/role all agree, and so every case is tested
 * (lib/__tests__/workspace.test.ts).
 *
 *   admin        a platform admin who is not viewing as someone. Their own
 *                organization role (if any) is shown inside the admin
 *                workspace as "My organization"; it does not turn them into
 *                staff.
 *   staff        anyone who OWNS an organization or holds a staff role in one
 *                (owner, org_admin, staff). Decided by the org role, never by
 *                users.tier: an owner whose cached tier says "client" is still
 *                staff, and a participant whose code once made them "partner"
 *                is not.
 *   participant  everyone else who is signed in: job seekers, members of an
 *                organization through a code, and partner-tier accounts with
 *                no org role.
 *   none         not signed in, or still loading.
 *
 * During view-as the session passed in is the EFFECTIVE one (the person being
 * viewed), so the answer is that person's workspace. The admin's own powers
 * never leak into it.
 */

export type Workspace = "admin" | "staff" | "participant" | "none";

export type WorkspaceOrgRole = "owner" | "org_admin" | "staff" | null | undefined;

export interface WorkspaceSession {
  /** The effective account id; null or empty when signed out. */
  userId?: string | null;
  /**
   * The cached tier. Only "admin" is read, and only because the database pins
   * it to platform_admin both ways (migration 047). Callers that know the
   * platform_admin row directly pass isPlatformAdmin instead.
   */
  tier?: string | null;
  isPlatformAdmin?: boolean;
  /** Present while an admin views or assists as this account. */
  impersonating?: { mode: string } | null;
}

export interface WorkspaceRoles {
  /** The org role from org_staff or ownership (getOrgContext), active orgs only. */
  orgRole?: WorkspaceOrgRole;
  /** Organizations the person joined as a participant. Informational: it never makes staff. */
  participantOf?: readonly string[];
}

const STAFF_ROLES = new Set(["owner", "org_admin", "staff"]);

export function resolveWorkspace(session: WorkspaceSession | null | undefined, roles: WorkspaceRoles | null | undefined): Workspace {
  if (!session || !session.userId) return "none";
  const admin = session.isPlatformAdmin ?? session.tier === "admin";
  if (admin && !session.impersonating) return "admin";
  if (roles?.orgRole && STAFF_ROLES.has(roles.orgRole)) return "staff";
  return "participant";
}

/** True when the staff workspace (OrgSidebar, Today, People) is the one to show. */
export function isStaffWorkspace(ws: Workspace): boolean {
  return ws === "staff";
}
