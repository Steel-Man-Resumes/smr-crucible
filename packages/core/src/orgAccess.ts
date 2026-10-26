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
  alreadyOnStaff,
  createNewAccountInvite,
  inviteDeniesFor,
  inviteExistingAccount,
  staffPlaces,
  validateStaffInviteInput,
  type StaffInvitePath,
} from "./staffInvites";
import {
  computeOrgCapabilities,
  capabilitiesForRole,
  DELEGABLE_CAPABILITIES,
  isOrgCapability,
  isStaffPreset,
  matchesPreset,
  presetOverrideWrites,
  STAFF_PRESETS,
  type StaffPreset,
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
  /** A named preset their access currently matches (staff only), or null. */
  preset: StaffPreset | null;
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
      preset: role === "staff" && matchesPreset("volunteer", effective) ? "volunteer" : null,
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

/** The plain refusal when an organization's staff places are all in use. */
export function staffCapReason(inUse: number, max: number): string {
  return `Your organization has ${inUse} of ${max} staff places in use. Remove someone from the team, or ask Steel Man Resumes for more places.`;
}

/**
 * Invite someone to the STAFF by email, at a role (owner and admins).
 *
 * WHY AN ADDRESS WITH AN ACCOUNT IS NO LONGER REFUSED, AND WHY IT IS NOT
 * ATTACHED EITHER. The refusal ("contact us") existed for two reasons: adding
 * an existing account would put that person's name on this roster without
 * their say, and the answer would tell the organization whether the address
 * has an account. Both still hold, so (migration 100) an existing account now
 * gets an INVITATION it accepts or declines after signing in, and nothing is
 * attached until it does. The inviter sees the same answer for a new address
 * and an existing one, and the same status words, so the screen still says
 * nothing about who has an account.
 *
 * A new address gets a shell account (so the emailed sign-in link works) and
 * the same invitation: nobody is on staff before saying yes (security review
 * B2), and nothing the organization sees differs between the two (B1).
 */
export async function inviteOrgStaff(actor: OrgActor, input: { name: string; email: string; role: string; title?: string | null }):
  Promise<{ ok: true; userId: string; email: string; name: string; inviteId: string; path: StaffInvitePath; undeliverable: boolean; renewed: boolean } | { ok: false; error: string }> {
  if (!canManage(actor)) return { ok: false, error: REFUSALS.refused };
  const v = validateStaffInviteInput(input);
  if (!v.ok) return v;
  const { name, email, role, preset, title } = v.value;
  if (role === "org_admin" && actor.role !== "owner") return { ok: false, error: "Only the owner can add an admin." };
  const scope = scopeOf(actor);

  const existing = await query<{ id: string }>(`SELECT u.id FROM users u WHERE u.email = $1`, [email]);
  if (existing[0] && (await alreadyOnStaff(scope, existing[0].id))) {
    return { ok: false, error: "That person is already on your staff." };
  }
  // STAFF CAP (migration 097, access_code.max_staff). Staff hold a Refinery
  // seat of their own, outside the participant seat count. Open invitations
  // to existing accounts hold a place too, so both paths fill up the same
  // way. Checked here for a plain answer and again inside each INSERT.
  const places = await staffPlaces(scope);
  if (!places.active) return { ok: false, error: "Your organization is closed right now, so nobody can be added." };
  if (existing[0]) {
    return inviteExistingAccount(scope, {
      userId: existing[0].id, email, name, role, title, denies: inviteDeniesFor(preset),
      fullReason: places.n >= places.max ? staffCapReason(places.n, places.max) : null,
    });
  }
  if (places.n >= places.max) return { ok: false, error: staffCapReason(places.n, places.max) };
  return createNewAccountInvite(scope, { name, email, role, title, preset });
}

/**
 * Put one staff member on a preset (today: volunteer). All the exception
 * writes run in one transaction through smr_set_capability_override, which
 * re-derives the actor and refuses what it always refuses (yourself, the
 * owner, an admin unless you are the owner).
 */
export async function applyStaffPreset(actor: OrgActor, targetUserId: string, preset: string, targetRole: OrgStaffRole):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManage(actor)) return { ok: false, error: REFUSALS.refused };
  if (!isStaffPreset(preset)) return { ok: false, error: "That is not a preset." };
  if (targetRole !== STAFF_PRESETS[preset].role) {
    return { ok: false, error: "Volunteer settings are for staff. Make them staff first." };
  }
  const writes = presetOverrideWrites(preset, targetRole);
  const out = await runScoped<{ r: string }[][]>(scopeOf(actor), (sql) =>
    writes.map((w) => sql`SELECT smr_set_capability_override(${targetUserId}::uuid, ${w.capability}, ${w.effect}) AS r`)
  );
  const bad = out.map((r) => r?.[0]?.r ?? "refused").find((r) => r !== "ok");
  return bad ? { ok: false, error: REFUSALS[bad] ?? REFUSALS.refused } : { ok: true };
}
