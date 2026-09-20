/**
 * Setting an organization up: who is on staff, as what, and what each person
 * may do. For the owner and admins (`org.staff.manage`).
 *
 * Reads the same tables the authorizer reads and computes effective access
 * with the same pure function (`computeOrgCapabilities`), so what this screen
 * SAYS somebody can do is what the system will LET them do. Writes to per-person
 * access go through `smr_set_capability_override`, which re-derives who the
 * actor is from the tables rather than trusting the application.
 */
import { query, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  computeOrgCapabilities,
  capabilitiesForRole,
  DELEGABLE_CAPABILITIES,
  isOrgCapability,
  type OrgCapability,
  type OrgStaffRole,
} from "./authz/capabilities";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const canManage = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.staff.manage");

export interface OrgAccessMember {
  userId: string;
  name: string | null;
  email: string | null;
  title: string | null;
  role: OrgStaffRole;
  /** Invited, has not signed in yet. */
  pending: boolean;
  invitedAt: string | null;
  caseload: number;
  lastSignInAt: string | null;
  notesLast30Days: number;
  /** Per capability on the delegable list: on/off, and whether that differs from their role. */
  access: { capability: OrgCapability; on: boolean; fromRole: boolean; override: "grant" | "deny" | null }[];
  /** Can the ACTOR change this person? (not themselves, not the owner, admins only by the owner) */
  editable: boolean;
}

export async function getOrgAccessOverview(actor: OrgActor): Promise<OrgAccessMember[] | null> {
  if (!canManage(actor)) return null;
  type Row = { user_id: string; name: string | null; email: string | null; title: string | null; role: string; pending: boolean; invited_at: string | null; caseload: number; last_sign_in: string | null; notes30: number };
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
  const [staff, owner] = await runScoped<[Row[], Row[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT os.user_id, u.name, u.email, os.title, os.role, os.invited_at,
              (u."emailVerified" IS NULL AND u.password_hash IS NULL
                 AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id)) AS pending,
              (SELECT COUNT(*)::int FROM client_staff_assignment a WHERE a.access_code_id = $1::uuid AND a.staff_user_id = os.user_id) AS caseload,
              (SELECT MAX(e.created_at) FROM user_login_event e WHERE e.user_id = os.user_id) AS last_sign_in,
              (SELECT COUNT(*)::int FROM case_note n WHERE n.access_code_id = $1::uuid AND n.author_user_id = os.user_id AND n.created_at > now() - interval '30 days') AS notes30
         FROM org_staff os JOIN users u ON u.id = os.user_id
        WHERE os.access_code_id = $1::uuid
        ORDER BY (os.role = 'org_admin') DESC, u.name`,
      [actor.orgId]
    ),
    run(sql)(
      `SELECT u.id AS user_id, u.name, u.email, NULL::text AS title, 'owner' AS role, NULL::timestamptz AS invited_at, false AS pending,
              (SELECT COUNT(*)::int FROM client_staff_assignment a WHERE a.access_code_id = $1::uuid AND a.staff_user_id = u.id) AS caseload,
              (SELECT MAX(e.created_at) FROM user_login_event e WHERE e.user_id = u.id) AS last_sign_in,
              (SELECT COUNT(*)::int FROM case_note n WHERE n.access_code_id = $1::uuid AND n.author_user_id = u.id AND n.created_at > now() - interval '30 days') AS notes30
         FROM access_code ac JOIN users u ON u.id = ac.partner_user_id WHERE ac.id = $1::uuid`,
      [actor.orgId]
    ),
  ]);
  const overrides = await query<{ user_id: string; capability: string; effect: "grant" | "deny" }>(
    `SELECT user_id, capability, effect FROM org_capability_override WHERE org_id = $1`,
    [actor.orgId]
  );

  const ownerId = owner[0]?.user_id;
  // The owner can also hold an org_staff row; show them once, as the owner.
  const people = [...owner, ...staff.filter((s) => s.user_id !== ownerId)];
  return people.map((p) => {
    const role = p.role as OrgStaffRole;
    const mine = overrides.filter((o) => o.user_id === p.user_id && isOrgCapability(o.capability));
    const effective = computeOrgCapabilities(
      role,
      mine.filter((o) => o.effect === "grant").map((o) => o.capability),
      mine.filter((o) => o.effect === "deny").map((o) => o.capability)
    );
    const base = new Set(capabilitiesForRole(role));
    return {
      userId: p.user_id, name: p.name, email: p.email, title: p.title, role,
      pending: !!p.pending, invitedAt: p.invited_at, caseload: p.caseload,
      lastSignInAt: p.last_sign_in, notesLast30Days: p.notes30,
      access: DELEGABLE_CAPABILITIES.map(({ capability }) => ({
        capability,
        on: effective.has(capability),
        fromRole: base.has(capability),
        override: mine.find((o) => o.capability === capability)?.effect ?? null,
      })),
      editable: role !== "owner" && p.user_id !== actor.userId && (role !== "org_admin" || actor.role === "owner"),
    };
  });
}

const REFUSALS: Record<string, string> = {
  refused: "You do not have access to that.",
  not_delegable: "That is not something that can be switched per person.",
  not_yourself: "You cannot change your own access. Ask the owner or another admin.",
  not_the_owner: "The owner's access cannot be changed.",
  not_staff: "That person is not on your staff.",
  owner_only: "Only the owner can change an admin's access.",
};

/**
 * Switch one capability on or off for one person. If the result matches what
 * their role already gives them, the exception is CLEARED rather than stored,
 * so a later change to the role's defaults reaches them too.
 */
export async function setStaffCapability(actor: OrgActor, targetUserId: string, capability: string, on: boolean, targetRole: OrgStaffRole):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManage(actor)) return { ok: false, error: REFUSALS.refused };
  if (!isOrgCapability(capability)) return { ok: false, error: REFUSALS.not_delegable };
  const fromRole = capabilitiesForRole(targetRole).includes(capability);
  const effect = on === fromRole ? "clear" : on ? "grant" : "deny";
  const [rows] = await runScoped<[{ r: string }[]]>(scopeOf(actor), (sql) => [
    sql`SELECT smr_set_capability_override(${targetUserId}::uuid, ${capability}, ${effect}) AS r`,
  ]);
  const r = rows[0]?.r ?? "refused";
  return r === "ok" ? { ok: true } : { ok: false, error: REFUSALS[r] ?? REFUSALS.refused };
}

/**
 * Invite someone to the STAFF by email, at a role. Before this the only way
 * onto staff was to be invited as a participant and then promoted.
 *
 * An email that already has an account elsewhere on the platform is refused
 * rather than attached: adding them would put their name on this roster, and
 * whether an address has an account is not this organization's to learn more
 * about than "we could not add that address".
 */
export async function inviteOrgStaff(actor: OrgActor, input: { name: string; email: string; role: string; title?: string | null }):
  Promise<{ ok: true; userId: string; email: string; name: string } | { ok: false; error: string }> {
  if (!canManage(actor)) return { ok: false, error: REFUSALS.refused };
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();
  const role = input.role === "org_admin" ? "org_admin" : "staff";
  if (role === "org_admin" && actor.role !== "owner") return { ok: false, error: "Only the owner can add an admin." };
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "A name and a valid email are needed." };

  const existing = await query<{ id: string; pending: boolean }>(
    `SELECT u.id, (u."emailVerified" IS NULL AND u.password_hash IS NULL
                   AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id)) AS pending
       FROM users u WHERE u.email = $1`,
    [email]
  );
  let userId: string;
  if (existing[0]) {
    const [mine] = await runScoped<[{ n: number }[]]>(scopeOf(actor), (sql) => [
      sql`SELECT (SELECT COUNT(*) FROM org_staff WHERE access_code_id = ${actor.orgId}::uuid AND user_id = ${existing[0].id}::uuid)::int AS n`,
    ]);
    if ((mine[0]?.n ?? 0) > 0) return { ok: false, error: "That person is already on your staff." };
    return { ok: false, error: "We could not add that address. If they already use Steel Man Resumes, contact us and we will help." };
  }
  const made = await query<{ id: string }>(`INSERT INTO users (name, email, tier) VALUES ($1, $2, 'partner') RETURNING id`, [name, email]);
  userId = made[0].id;
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
  const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `INSERT INTO org_staff (access_code_id, user_id, role, title, created_by, invited_at, invited_email)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, now(), $6) RETURNING id`,
      [actor.orgId, userId, role, input.title?.trim() || null, actor.userId, email]
    ),
  ]);
  if (!rows[0]) {
    await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {}); // just created here, safe to remove
    return { ok: false, error: "Could not add them to your staff." };
  }
  return { ok: true, userId, email, name };
}
