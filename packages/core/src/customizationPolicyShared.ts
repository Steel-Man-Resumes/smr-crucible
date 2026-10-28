/**
 * What staff may change about their OWN screens (staff build S3, migration
 * 108). PURE and client-safe; the database half is ./customizationPolicy.
 *
 * Troy, 2026-10-27: "Org admins can edit the structure and staff can suggest
 * changes but they should also have some limited ability to change their own
 * interface." The organization's managers (owner and org admins) set, per
 * role and screen, which personal changes that role may make. Everything is
 * allowed until a manager turns it off, because a personal change only ever
 * affects the person who made it.
 *
 * ENFORCED TWICE, in core: when prefs and personal views are WRITTEN (a change
 * to a locked choice is refused in plain words) and when they are READ (a
 * stored choice the policy now locks is ignored, not deleted, so loosening the
 * policy brings it back). The screens and t.ROY read the same answer, so a
 * locked control is drawn locked and t.ROY never offers it.
 *
 * The OWNER is never limited by it: who would lock the owner's own screen?
 */
import type { StaffPrefs } from "./staffPrefsShared";

export const POLICY_ROLES = ["org_admin", "staff"] as const;
export type PolicyRole = (typeof POLICY_ROLES)[number];
export const POLICY_ROLE_LABELS: Record<PolicyRole, string> = { org_admin: "Admins", staff: "Staff" };
export const isPolicyRole = (v: unknown): v is PolicyRole => typeof v === "string" && (POLICY_ROLES as readonly string[]).includes(v);

export const POLICY_SURFACES = ["today", "people", "person"] as const;
export type PolicySurface = (typeof POLICY_SURFACES)[number];
export const POLICY_SURFACE_LABELS: Record<PolicySurface, string> = { today: "Today", people: "People", person: "A person's page" };
export const isPolicySurface = (v: unknown): v is PolicySurface => typeof v === "string" && (POLICY_SURFACES as readonly string[]).includes(v);

export const POLICY_KEYS = {
  today: ["today_order", "today_fold", "today_hide"],
  people: ["personal_views", "columns", "column_width", "density", "default_view", "grid_edit"],
  person: ["person_tabs_order"],
} as const satisfies Record<PolicySurface, readonly string[]>;
export type PolicyKey = (typeof POLICY_KEYS)[PolicySurface][number];
export const ALL_POLICY_KEYS: readonly PolicyKey[] = POLICY_SURFACES.flatMap((s) => POLICY_KEYS[s] as readonly PolicyKey[]);
export const isPolicyKey = (v: unknown): v is PolicyKey => typeof v === "string" && (ALL_POLICY_KEYS as readonly string[]).includes(v);
export const surfaceOfKey = (k: PolicyKey): PolicySurface => POLICY_SURFACES.find((s) => (POLICY_KEYS[s] as readonly string[]).includes(k))!;

/** What each switch means, in the words the Layouts page shows a manager. */
export const POLICY_KEY_TEXT: Record<PolicyKey, { label: string; help: string }> = {
  today_order: { label: "Put Today's sections in their own order", help: "For example, tasks first. Only their own Today changes." },
  today_fold: { label: "Fold a Today section", help: "The heading and its count stay; the rows are one tap away." },
  today_hide: { label: "Hide a Today section for themselves", help: "Off: everyone sees every section your layout shows." },
  personal_views: { label: "Save their own views of People", help: "Their own filters, sort and groups, saved by name. Nobody else sees them." },
  columns: { label: "Choose and order their own People columns", help: "Off: everyone sees the columns in your layout." },
  column_width: { label: "Resize, freeze and total columns in the grid", help: "How wide a column is, which stay put, and the summary row." },
  density: { label: "Pick short, medium or tall rows", help: "How much fits on their screen." },
  default_view: { label: "Pick which view People opens with", help: "Off: People opens with the view you set for their role." },
  grid_edit: { label: "Fill in your fields from the grid", help: "Only fields they may already fill in on a person's page, only for people they work with. Off: they fill them in on the person's page." },
  person_tabs_order: { label: "Put a person's page tabs in their own order", help: "For example, Timeline first." },
};

/** Said when a change is refused because the organization locked it. Plain, never blaming. */
export const POLICY_LOCKED_TEXT: Record<PolicyKey, string> = {
  today_order: "Your organization keeps the order of Today the same for everyone.",
  today_fold: "Your organization keeps Today's sections open for everyone.",
  today_hide: "Your organization keeps every Today section showing for everyone.",
  personal_views: "Your organization does not use personal views. The shared views are in the view menu.",
  columns: "Your organization keeps the People columns the same for everyone.",
  column_width: "Your organization keeps the grid's columns the same for everyone.",
  density: "Your organization keeps the row height the same for everyone.",
  default_view: "Your organization chooses which view People opens with.",
  grid_edit: "Your organization has fields filled in on each person's page, not in the grid.",
  person_tabs_order: "Your organization keeps a person's page tabs in the same order for everyone.",
};
export const SUGGEST_CHANGE_LINE = "If it should change, ask whoever manages your organization's settings.";

export type PolicyAllowed = Record<PolicyKey, boolean>;
export const ALL_ALLOWED: PolicyAllowed = Object.fromEntries(ALL_POLICY_KEYS.map((k) => [k, true])) as PolicyAllowed;

/** One stored row, cleaned: only this surface's keys, only booleans. */
export function normalizeAllowed(surface: PolicySurface, raw: unknown): Partial<Record<PolicyKey, boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<PolicyKey, boolean>> = {};
  for (const k of POLICY_KEYS[surface] as readonly PolicyKey[]) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out;
}

export interface PolicyRow { role: string; surface: string; allowed: unknown }

/** The switches for one role. The owner (and any role not on the list) gets everything. */
export function resolvePolicy(role: string, rows: readonly PolicyRow[]): PolicyAllowed {
  const out: PolicyAllowed = { ...ALL_ALLOWED };
  if (!isPolicyRole(role)) return out;
  for (const r of rows) {
    if (r.role !== role || !isPolicySurface(r.surface)) continue;
    Object.assign(out, normalizeAllowed(r.surface, r.allowed));
  }
  return out;
}

/** Every policy role's switches, for the Layouts page. */
export function resolveAllPolicies(rows: readonly PolicyRow[]): Record<PolicyRole, PolicyAllowed> {
  return Object.fromEntries(POLICY_ROLES.map((r) => [r, resolvePolicy(r, rows)])) as Record<PolicyRole, PolicyAllowed>;
}

/**
 * Which policy switch governs each personal preference. A preference not in
 * this list (landing page, note type, suggestions, rewards...) is always the
 * person's own: it changes nothing anyone else relies on.
 */
export const PREF_POLICY: Partial<Record<keyof StaffPrefs, PolicyKey>> = {
  todayOrder: "today_order",
  todayCollapsed: "today_fold",
  todayHidden: "today_hide",
  caseloadHidden: "columns",
  caseloadColumns: "columns",
  caseloadSort: "default_view",
  defaultView: "default_view",
  density: "density",
  viewLayouts: "column_width",
  personTabs: "person_tabs_order",
};

/**
 * A person's own prefs with every choice the policy locks taken out (READ
 * time). Nothing is deleted from storage: the caller falls back to the org's
 * default for a dropped key. Row height inside a stored layout follows the
 * density switch.
 */
export function prefsUnderPolicy(own: Partial<StaffPrefs>, allowed: PolicyAllowed): Partial<StaffPrefs> {
  const out: Partial<StaffPrefs> = { ...own };
  for (const [k, p] of Object.entries(PREF_POLICY) as [keyof StaffPrefs, PolicyKey][]) {
    if (!allowed[p]) delete out[k];
  }
  if (out.viewLayouts && !allowed.density) {
    out.viewLayouts = Object.fromEntries(Object.entries(out.viewLayouts).map(([k, l]) => [k, { ...l, rowHeight: null }]));
  }
  return out;
}

/**
 * The locked switches a WRITE would change: every governed key whose value
 * differs between what is stored now and what is asked for, while its switch
 * is off. Empty = the write may go ahead. Comparing values (not presence)
 * means a full-object save from the Settings page that leaves a locked
 * choice as it was is not refused.
 */
export function lockedChanges(before: Partial<StaffPrefs>, after: Partial<StaffPrefs>, allowed: PolicyAllowed): PolicyKey[] {
  const hit = new Set<PolicyKey>();
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const [k, p] of Object.entries(PREF_POLICY) as [keyof StaffPrefs, PolicyKey][]) {
    if (allowed[p]) continue;
    if (k === "viewLayouts" && allowed.column_width) continue;
    if (!same(before[k], after[k])) hit.add(p);
  }
  // Row height lives inside a layout but follows the density switch.
  if (!allowed.density && allowed.column_width) {
    const heights = (m: Partial<StaffPrefs>["viewLayouts"]) => Object.fromEntries(Object.entries(m ?? {}).map(([k, l]) => [k, l.rowHeight]));
    if (!same(heights(before.viewLayouts), heights(after.viewLayouts))) hit.add("density");
  }
  return ALL_POLICY_KEYS.filter((k) => hit.has(k));
}

/** The plain refusal for a list of locked switches. */
export function lockedMessage(keys: readonly PolicyKey[]): string {
  if (!keys.length) return "";
  return `${POLICY_LOCKED_TEXT[keys[0]]} ${SUGGEST_CHANGE_LINE}`;
}

/** Every switch a person's role has off, for screens and t.ROY to show as locked. */
export function lockedKeys(allowed: PolicyAllowed): PolicyKey[] {
  return ALL_POLICY_KEYS.filter((k) => !allowed[k]);
}
