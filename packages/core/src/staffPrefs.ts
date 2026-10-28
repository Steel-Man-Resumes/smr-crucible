/**
 * Staff workflow preferences: the database half. See staffPrefsShared.ts for
 * the rules. `users` and `access_code` are not row-level protected; the view
 * change log (108) is, so writes that log run in the organization scope.
 *
 * THE ORGANIZATION'S POLICY (108, customizationPolicyShared) applies on both
 * sides: getStaffPrefs leaves out any choice the policy locks for this
 * person's role (stored, not deleted), and setOwnStaffPrefs refuses a write
 * that would change a locked choice. Every choice that does change is logged
 * for the person, one row per choice, so each can be undone.
 */
import { getOne, query, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { getQuietAfterDays } from "./orgStaffPerformance";
import { getMyCustomizationPolicy, isPolicyTableMissing } from "./customizationPolicy";
import { lockedChanges, lockedMessage, lockedKeys as lockedKeyList, type PolicyAllowed, type PolicyKey } from "./customizationPolicyShared";
import { normalizeStaffPrefs, prefsDelta, resolveStaffPrefs, DEFAULT_STAFF_PREFS, type StaffPrefs } from "./staffPrefsShared";

export * from "./staffPrefsShared";

export interface StaffPrefsState {
  /** What the screens should use (the organization's policy already applied). */
  effective: StaffPrefs;
  /** Only what this person set themselves (as stored, including choices the policy now locks). */
  own: Partial<StaffPrefs>;
  /** Only what their organization set. */
  orgDefaults: Partial<StaffPrefs>;
  canSetOrgDefaults: boolean;
  /** The organization's "quiet after N days". One number for everyone, on purpose. */
  quietAfterDays: number;
  /** What this person may change for themselves (108). Every switch on for the owner. */
  allowed: PolicyAllowed;
  /** The switches that are off, for screens to draw those controls locked. */
  locked: PolicyKey[];
}

/** People who manage the organization's settings: the owner and org admins (Troy 2026-10-27). */
const canManageSettings = (actor: OrgActor) => !actor.viaPlatformAdmin && actor.capabilities.has("org.settings.manage");

export async function getStaffPrefs(actor: OrgActor): Promise<StaffPrefsState> {
  const [u, o, allowed] = await Promise.all([
    getOne<{ staff_prefs: unknown }>(`SELECT staff_prefs FROM users WHERE id = $1`, [actor.userId]),
    getOne<{ staff_pref_defaults: unknown }>(`SELECT staff_pref_defaults FROM access_code WHERE id = $1`, [actor.orgId]),
    getMyCustomizationPolicy(actor),
  ]);
  return {
    effective: resolveStaffPrefs(o?.staff_pref_defaults, u?.staff_prefs, allowed),
    own: normalizeStaffPrefs(u?.staff_prefs),
    orgDefaults: normalizeStaffPrefs(o?.staff_pref_defaults),
    canSetOrgDefaults: canManageSettings(actor),
    quietAfterDays: await getQuietAfterDays(actor.orgId),
    allowed,
    locked: lockedKeyList(allowed),
  };
}

export type SetPrefsResult = { ok: true } | { ok: false; error: string; locked: PolicyKey[] };

const PREF_SURFACE: Partial<Record<keyof StaffPrefs, "today" | "people" | "person">> = {
  todayHidden: "today", todayCollapsed: "today", todayOrder: "today", landing: "today",
  caseloadSort: "people", caseloadHidden: "people", caseloadColumns: "people", defaultView: "people", density: "people", peopleMode: "people", viewLayouts: "people",
  clientTab: "person", personTabs: "person", noteKind: "person", noteVisible: "person",
};
const PREF_WORDS: Partial<Record<keyof StaffPrefs, string>> = {
  landing: "where you land", todayHidden: "which Today sections you see", todayCollapsed: "which Today sections are folded", todayOrder: "the order of Today",
  caseloadSort: "your usual People order", caseloadHidden: "your People columns", caseloadColumns: "your People columns", defaultView: "which view People opens with",
  density: "row height", peopleMode: "list or grid", viewLayouts: "how the grid looks", clientTab: "which tab a person's page opens on",
  personTabs: "the order of a person's page tabs", noteKind: "your usual note type", noteVisible: "whether notes start shared",
  troySuggestions: "t.ROY's suggestions", rewardsOn: "rewards", savedViews: "your old saved sorts",
};

/**
 * Replace this person's own choices. Pass {} to go back to the org's
 * defaults. Refused, with plain words, when it would change a choice the
 * organization locks for this role.
 */
export async function setOwnStaffPrefs(actor: OrgActor, prefs: unknown): Promise<SetPrefsResult> {
  const [u, allowed] = await Promise.all([
    getOne<{ staff_prefs: unknown }>(`SELECT staff_prefs FROM users WHERE id = $1`, [actor.userId]),
    getMyCustomizationPolicy(actor, { forWrite: true }),
  ]);
  const before = normalizeStaffPrefs(u?.staff_prefs);
  const after = normalizeStaffPrefs(prefs);
  const blocked = lockedChanges(before, after, allowed);
  if (blocked.length) return { ok: false, error: lockedMessage(blocked), locked: blocked };
  // Only the choices that changed are written, on the stored object: a
  // choice changed elsewhere since this read is kept, and so is the
  // server-owned viewsMovedTo marker (savedViews.ts, migrateLegacySavedViews),
  // which the normalizer never lets a client set.
  const delta = prefsDelta(before, after);
  const UPDATE = `UPDATE users SET staff_prefs = (COALESCE(staff_prefs, '{}'::jsonb) - $3::text[]) || $2::jsonb WHERE id = $1`;
  const params = [actor.userId, JSON.stringify(delta.set), delta.remove];
  const changed = (Object.keys(DEFAULT_STAFF_PREFS) as (keyof StaffPrefs)[])
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .slice(0, 20);
  if (!changed.length) return { ok: true };
  if (actor.viaPlatformAdmin) {
    await query(UPDATE, params);
    return { ok: true };
  }
  const scope: OrgScope = { orgId: actor.orgId, userId: actor.userId, role: actor.role };
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
  const LOG = `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, before, after, by_ai)
    VALUES ($1::uuid, $2::uuid, $3, 'settings', $4, $5, $6::jsonb, $7::jsonb, false)`;
  try {
    await runScoped(scope, (sql) => [
      run(sql)(UPDATE, params),
      ...changed.map((k) => run(sql)(LOG, [
        actor.orgId, actor.userId, PREF_SURFACE[k] ?? "people", `pref:${k}`,
        `Changed ${PREF_WORDS[k] ?? "a setting"} in My workflow`, JSON.stringify(before[k] ?? null), JSON.stringify(after[k] ?? null),
      ])),
    ]);
  } catch (err) {
    if (!isPolicyTableMissing(err)) throw err;
    await query(UPDATE, params);
  }
  return { ok: true };
}

/** Replace the organization's defaults. Managers only (`org.settings.manage`: the owner and org admins). */
export async function setOrgStaffPrefDefaults(actor: OrgActor, prefs: unknown): Promise<boolean> {
  if (!canManageSettings(actor)) return false;
  await query(`UPDATE access_code SET staff_pref_defaults = $2::jsonb WHERE id = $1`, [actor.orgId, JSON.stringify(normalizeStaffPrefs(prefs))]);
  return true;
}

/**
 * Set the organization's "quiet after N days". Managers only. It is not a
 * personal preference: the caseload, Insights, Today and the assistant all
 * read this one number, so they always agree about who has gone quiet.
 */
export async function setQuietAfterDays(actor: OrgActor, days: number): Promise<boolean> {
  if (!canManageSettings(actor)) return false;
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 3 || n > 90) return false;
  await query(`UPDATE access_code SET quiet_after_days = $2 WHERE id = $1`, [actor.orgId, n]);
  return true;
}
