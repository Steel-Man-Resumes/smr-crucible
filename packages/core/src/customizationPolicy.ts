/**
 * What staff may change about their own screens: the database half (migration
 * 108, org_customization_policy). See customizationPolicyShared.ts for the
 * rules. Every statement runs in the organization scope, so 108's policies
 * apply: the organization's staff read, its managers (owner, org admin) write.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  ALL_ALLOWED, POLICY_KEYS, isPolicyRole, isPolicySurface, normalizeAllowed, resolveAllPolicies, resolvePolicy,
  type PolicyAllowed, type PolicyRole, type PolicyRow, type PolicySurface,
} from "./customizationPolicyShared";

export * from "./customizationPolicyShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;

/** Who may change the policy: the organization's managers, never a platform admin acting for it. */
export const canManageCustomizationPolicy = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.settings.manage");

/** True when the error says 108's tables are not there yet. */
export function isPolicyTableMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = String((err as { message?: string })?.message ?? "");
  return code === "42P01" || /relation "?(public\.)?(org_customization_policy|view_change_log)"? does not exist/.test(msg);
}

/** Every stored row for the organization. [] before 108 (everything allowed). */
export async function getPolicyRows(actor: OrgActor): Promise<PolicyRow[]> {
  try {
    const [rows] = await runScoped<[PolicyRow[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT role, surface, allowed FROM org_customization_policy WHERE access_code_id = $1::uuid`, [actor.orgId]),
    ]);
    return rows;
  } catch (err) {
    if (isPolicyTableMissing(err)) return [];
    throw err;
  }
}

/**
 * The switches for the actor's own role. A platform admin acting for an org
 * changes nothing personal there (the app keeps them read-only), so they get
 * the staff answer, the narrowest one.
 */
export async function getMyCustomizationPolicy(actor: OrgActor, opts: { forWrite?: boolean } = {}): Promise<PolicyAllowed> {
  if (actor.role === "owner" && !actor.viaPlatformAdmin) return { ...ALL_ALLOWED };
  let rows: PolicyRow[];
  try {
    // A missing 108 table is "nothing set yet" (getPolicyRows answers []).
    rows = await getPolicyRows(actor);
  } catch (err) {
    // Any other failure never opens the limits: a write stops here; a read
    // treats every personal choice as locked (the organization's defaults show).
    if (opts.forWrite) throw err;
    return { ...NONE_ALLOWED };
  }
  return resolvePolicy(actor.viaPlatformAdmin ? "staff" : actor.role, rows);
}

/** Every switch off: what a read uses when the policy cannot be read. */
const NONE_ALLOWED: PolicyAllowed = Object.fromEntries(Object.keys(ALL_ALLOWED).map((k) => [k, false])) as PolicyAllowed;

/** Every role's switches, for the Layouts page. */
export async function getAllCustomizationPolicies(actor: OrgActor): Promise<Record<PolicyRole, PolicyAllowed>> {
  return resolveAllPolicies(await getPolicyRows(actor));
}

export type PolicyResult = { ok: true; policies: Record<PolicyRole, PolicyAllowed> } | { ok: false; error: string };

/**
 * Set one role's switches for one screen. `allowed` is merged over what is
 * stored (a key left out stays as it was). `null` puts the screen back to
 * "everything allowed" for that role.
 */
export async function setCustomizationPolicy(actor: OrgActor, role: unknown, surface: unknown, allowed: unknown | null): Promise<PolicyResult> {
  if (!canManageCustomizationPolicy(actor)) return { ok: false, error: "Only someone who manages your organization's settings can change what staff may change." };
  if (!isPolicyRole(role)) return { ok: false, error: "Choose a role." };
  if (!isPolicySurface(surface)) return { ok: false, error: "Choose a screen." };
  try {
    if (allowed === null) {
      await runScoped(scopeOf(actor), (sql) => [
        run(sql)(`DELETE FROM org_customization_policy WHERE access_code_id = $1::uuid AND role = $2 AND surface = $3`, [actor.orgId, role, surface]),
      ]);
    } else {
      const clean = normalizeAllowed(surface as PolicySurface, allowed);
      if (!Object.keys(clean).length) return { ok: false, error: "Nothing to change." };
      // Store the whole screen's switches, so a row always says every choice.
      const current = resolvePolicy(role, await getPolicyRows(actor));
      const row = Object.fromEntries((POLICY_KEYS[surface as PolicySurface] as readonly string[]).map((k) => [k, (clean as Record<string, boolean>)[k] ?? (current as Record<string, boolean>)[k]]));
      await runScoped(scopeOf(actor), (sql) => [
        run(sql)(
          `INSERT INTO org_customization_policy (access_code_id, role, surface, allowed, updated_by) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)
           ON CONFLICT (access_code_id, role, surface) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by`,
          [actor.orgId, role, surface, JSON.stringify(row), actor.userId],
        ),
      ]);
    }
    return { ok: true, policies: await getAllCustomizationPolicies(actor) };
  } catch (err) {
    if (isPolicyTableMissing(err)) return { ok: false, error: "This is not switched on yet for this workspace." };
    const code = (err as { code?: string })?.code;
    return { ok: false, error: code === "42501" ? "You do not have access to that." : "That did not save. Try again." };
  }
}
