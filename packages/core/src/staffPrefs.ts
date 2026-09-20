/**
 * Staff workflow preferences: the database half. See staffPrefsShared.ts for
 * the rules. `users` and `access_code` are not row-level protected, so plain
 * query() is correct here.
 */
import { getOne, query } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { normalizeStaffPrefs, resolveStaffPrefs, type StaffPrefs } from "./staffPrefsShared";

export * from "./staffPrefsShared";

export interface StaffPrefsState {
  /** What the screens should use. */
  effective: StaffPrefs;
  /** Only what this person set themselves. */
  own: Partial<StaffPrefs>;
  /** Only what their organization set. */
  orgDefaults: Partial<StaffPrefs>;
  canSetOrgDefaults: boolean;
}

export async function getStaffPrefs(actor: OrgActor): Promise<StaffPrefsState> {
  const [u, o] = await Promise.all([
    getOne<{ staff_prefs: unknown }>(`SELECT staff_prefs FROM users WHERE id = $1`, [actor.userId]),
    getOne<{ staff_pref_defaults: unknown }>(`SELECT staff_pref_defaults FROM access_code WHERE id = $1`, [actor.orgId]),
  ]);
  return {
    effective: resolveStaffPrefs(o?.staff_pref_defaults, u?.staff_prefs),
    own: normalizeStaffPrefs(u?.staff_prefs),
    orgDefaults: normalizeStaffPrefs(o?.staff_pref_defaults),
    canSetOrgDefaults: !actor.viaPlatformAdmin && actor.capabilities.has("org.settings.manage"),
  };
}

/** Replace this person's own choices. Pass {} to go back to the org's defaults. */
export async function setOwnStaffPrefs(actor: OrgActor, prefs: unknown): Promise<void> {
  await query(`UPDATE users SET staff_prefs = $2::jsonb WHERE id = $1`, [actor.userId, JSON.stringify(normalizeStaffPrefs(prefs))]);
}

/** Replace the organization's defaults. Owner only (`org.settings.manage`). */
export async function setOrgStaffPrefDefaults(actor: OrgActor, prefs: unknown): Promise<boolean> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.settings.manage")) return false;
  await query(`UPDATE access_code SET staff_pref_defaults = $2::jsonb WHERE id = $1`, [actor.orgId, JSON.stringify(normalizeStaffPrefs(prefs))]);
  return true;
}
