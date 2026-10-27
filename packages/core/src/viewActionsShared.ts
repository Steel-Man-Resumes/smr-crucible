/**
 * The typed view action layer: the PURE half (staff build S3, 2026-10-27).
 * The database half is ./viewActions.
 *
 * ONE LAYER FOR THE SCREENS AND FOR t.ROY. Every change a person makes to
 * their OWN view (Today order and folds, People columns and grid look, row
 * height, which view opens first, their own saved views, a person's page tab
 * order) goes through these planners, by hand or by asking t.ROY. Each
 * planner checks the organization's customization policy for the person's
 * role, cleans the input against the same allowlists as the prefs and views
 * normalizers, and returns the value before and after, so the change can be
 * logged (view_change_log, 108) and undone from one list.
 *
 * WHAT THIS LAYER NEVER DOES: change anything other people see (shared views,
 * role layouts, org defaults, the policy itself), widen what anyone can read,
 * or touch a participant's record. Those stay on their own routes with a
 * manager's capability and a click.
 */
import { POLICY_LOCKED_TEXT, SUGGEST_CHANGE_LINE, type PolicyAllowed, type PolicyKey } from "./customizationPolicyShared";
import { TODAY_SECTION_LABELS, type TodaySection } from "./orgTodayItems";
import {
  DEFAULT_STAFF_PREFS, PEOPLE_MODES, PERSON_TAB_KEYS, TODAY_SECTION_KEYS, normalizeStaffPrefs,
  type PeopleMode, type PersonTabKey, type StaffPrefs, type TodaySectionKey,
} from "./staffPrefsShared";
import {
  ROW_DENSITY_LABELS, MAX_FROZEN, SUMMARY_LABELS, clampWidth, isRowDensity, isEmptyGridLayout, isLayoutColumnId, isSummaryKind, layoutKeyFor,
  normalizeGridLayout, EMPTY_GRID_LAYOUT, type RowDensity, type GridLayout, type SummaryKind,
} from "./viewLayoutShared";

export const VIEW_ACTIONS = [
  "setTodayOrder", "foldSection", "hideSection", "setColumns", "setColumnWidth", "setGridLayout", "setDensity", "setPeopleMode",
  "setDefaultView", "saveMyView", "updateMyView", "deleteMyView", "setPersonTabsOrder", "undoViewChange",
] as const;
export type ViewActionName = (typeof VIEW_ACTIONS)[number];

export const LOG_SURFACES = ["today", "people", "person", "views"] as const;
export type LogSurface = (typeof LOG_SURFACES)[number];

/** One change, ready to write and to log. `before`/`after` belong to `target`. */
export interface PlannedChange {
  surface: LogSurface;
  action: string;
  /** "pref:<key>", "layout:<default|view id>" or "view:<id>". */
  target: string;
  summary: string;
  before: unknown;
  after: unknown;
}

export type PlanFail = { ok: false; error: string; reason: "policy" | "invalid" | "unchanged" | "missing" | "access" };
export type PrefPlan = { ok: true; change: PlannedChange; nextOwn: Partial<StaffPrefs> } | PlanFail;

const locked = (k: PolicyKey): PlanFail => ({ ok: false, reason: "policy", error: `${POLICY_LOCKED_TEXT[k]} ${SUGGEST_CHANGE_LINE}` });
const invalid = (error: string): PlanFail => ({ ok: false, reason: "invalid", error });
const unchanged = (error = "That is already how it is."): PlanFail => ({ ok: false, reason: "unchanged", error });
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const sectionLabel = (k: string) => TODAY_SECTION_LABELS[k as TodaySection] ?? k;

/** The person's own stored value for a pref (null = not set, the organization's default applies). */
const ownValue = <K extends keyof StaffPrefs>(own: Partial<StaffPrefs>, k: K): StaffPrefs[K] | null => (own[k] === undefined ? null : (own[k] as StaffPrefs[K]));

/**
 * Set one pref to `next` (null = clear it back to the organization's
 * default). The value is normalized exactly as a stored pref would be.
 */
export function planPref<K extends keyof StaffPrefs>(
  own: Partial<StaffPrefs>, key: K, next: StaffPrefs[K] | null, allowed: PolicyAllowed, policyKey: PolicyKey | null,
  meta: { surface: LogSurface; action: string; summary: string },
): PrefPlan {
  if (policyKey && !allowed[policyKey]) return locked(policyKey);
  let clean: StaffPrefs[K] | null = null;
  if (next !== null) {
    const n = normalizeStaffPrefs({ [key]: next }) as Partial<StaffPrefs>;
    if (n[key] === undefined) return invalid("That choice is not one of the options.");
    clean = n[key] as StaffPrefs[K];
  }
  const before = ownValue(own, key);
  if (same(before, clean)) return unchanged();
  const nextOwn: Partial<StaffPrefs> = { ...own };
  if (clean === null) delete nextOwn[key];
  else nextOwn[key] = clean;
  return { ok: true, nextOwn, change: { surface: meta.surface, action: meta.action, target: `pref:${String(key)}`, summary: meta.summary, before, after: clean } };
}

/* ------------------------------------------------------------- Today ---- */

/** Today's sections in a new order. [] = back to the organization's order. */
export function planTodayOrder(own: Partial<StaffPrefs>, order: readonly unknown[], allowed: PolicyAllowed): PrefPlan {
  const keys = Array.from(new Set(order.filter((k): k is TodaySectionKey => typeof k === "string" && (TODAY_SECTION_KEYS as readonly string[]).includes(k))));
  if (order.length && !keys.length) return invalid("Those are not sections on Today.");
  return planPref(own, "todayOrder", keys.length ? keys : null, allowed, "today_order", {
    surface: "today", action: "today_order",
    summary: keys.length ? `Put "${sectionLabel(keys[0])}" first on Today` : "Put Today back in your organization's order",
  });
}

/** Fold (true) or open (false) one Today section. */
export function planFold(own: Partial<StaffPrefs>, section: unknown, folded: boolean, allowed: PolicyAllowed): PrefPlan {
  if (typeof section !== "string" || !(TODAY_SECTION_KEYS as readonly string[]).includes(section)) return invalid("That is not a section on Today.");
  const cur = own.todayCollapsed ?? [];
  const next = folded ? Array.from(new Set([...cur, section as TodaySectionKey])) : cur.filter((k) => k !== section);
  return planPref(own, "todayCollapsed", next, allowed, "today_fold", {
    surface: "today", action: folded ? "today_fold" : "today_unfold",
    summary: `${folded ? "Folded" : "Opened"} "${sectionLabel(section)}" on Today`,
  });
}

/** Hide (true) or show (false) one Today section, for this person only. */
export function planHide(own: Partial<StaffPrefs>, section: unknown, hidden: boolean, allowed: PolicyAllowed): PrefPlan {
  if (typeof section !== "string" || !(TODAY_SECTION_KEYS as readonly string[]).includes(section)) return invalid("That is not a section on Today.");
  const cur = own.todayHidden ?? [];
  const next = hidden ? Array.from(new Set([...cur, section as TodaySectionKey])) : cur.filter((k) => k !== section);
  return planPref(own, "todayHidden", next, allowed, "today_hide", {
    surface: "today", action: hidden ? "today_hide" : "today_show",
    summary: `${hidden ? "Hid" : "Showed"} "${sectionLabel(section)}" on your Today`,
  });
}

/* ------------------------------------------------------------- People --- */

/** Words for a column change: "Showed Housing and hid Status". */
export function columnChangeWords(before: readonly string[], after: readonly string[], labelOf: (id: string) => string): string {
  const added = after.filter((c) => !before.includes(c)).map(labelOf);
  const removed = before.filter((c) => !after.includes(c)).map(labelOf);
  const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`);
  const parts = [added.length ? `showed ${list(added)}` : "", removed.length ? `hid ${list(removed)}` : ""].filter(Boolean);
  if (!parts.length) return "Moved columns around";
  const s = parts.join(" and ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Clean a column list: known ids, no "name" (always first), no repeats, at most 30. */
export function cleanColumns(columns: readonly unknown[]): string[] {
  return Array.from(new Set(columns.filter(isLayoutColumnId).filter((c) => c !== "name"))).slice(0, 30);
}

/** This person's People columns when no view is chosen. null = back to the role's columns. */
export function planDefaultColumns(own: Partial<StaffPrefs>, columns: readonly unknown[] | null, allowed: PolicyAllowed, currentShown: readonly string[], labelOf: (id: string) => string): PrefPlan {
  const next = columns === null ? null : cleanColumns(columns);
  if (columns !== null && columns.length && !next?.length) return invalid("Those are not columns on People.");
  return planPref(own, "caseloadColumns", next && next.length ? next : null, allowed, "columns", {
    surface: "people", action: "columns",
    summary: next && next.length ? `${columnChangeWords(currentShown, next, labelOf)} on People` : "Put People back to your organization's columns",
  });
}

/** How People opens: a view id, "none" (everyone, no view) or null (the usual rule). */
export function planDefaultView(own: Partial<StaffPrefs>, viewId: string | null, allowed: PolicyAllowed, viewName: string | null): PrefPlan {
  return planPref(own, "defaultView", viewId, allowed, "default_view", {
    surface: "people", action: "default_view",
    summary: viewId === null ? "People opens with the usual view again" : viewId === "none" ? "People opens with everyone, no view" : `People now opens with "${viewName ?? "your view"}"`,
  });
}

export function planDensity(own: Partial<StaffPrefs>, density: unknown, allowed: PolicyAllowed): PrefPlan {
  if (!isRowDensity(density)) return invalid("Pick short, medium or tall rows.");
  return planPref(own, "density", density, allowed, "density", { surface: "people", action: "density", summary: `${ROW_DENSITY_LABELS[density]} on People` });
}

export function planPeopleMode(own: Partial<StaffPrefs>, mode: unknown, allowed: PolicyAllowed): PrefPlan {
  if (typeof mode !== "string" || !(PEOPLE_MODES as readonly string[]).includes(mode)) return invalid("Pick the list or the grid.");
  return planPref(own, "peopleMode", mode as PeopleMode, allowed, null, {
    surface: "people", action: "people_mode", summary: mode === "grid" ? "People opens as a grid" : "People opens as a list",
  });
}

/** A patch to one view's grid look, for this person only. */
export interface GridLayoutPatch {
  widths?: Record<string, number | null>;
  frozen?: number;
  rowHeight?: RowDensity | null;
  summaries?: Record<string, SummaryKind | null>;
}

/** Words for a grid look change. */
export function gridChangeWords(before: GridLayout, after: GridLayout, labelOf: (id: string) => string): string {
  if (before.frozen !== after.frozen) return after.frozen === 0 ? "Unfroze the grid's columns" : after.frozen === 1 ? "Froze the name column" : `Froze the first ${after.frozen} columns`;
  if (before.rowHeight !== after.rowHeight) return after.rowHeight ? `${ROW_DENSITY_LABELS[after.rowHeight]} in this view` : "Usual row height in this view";
  const sumKeys = Array.from(new Set([...Object.keys(before.summaries), ...Object.keys(after.summaries)])).filter((k) => before.summaries[k] !== after.summaries[k]);
  if (sumKeys.length === 1) {
    const k = sumKeys[0];
    return after.summaries[k] ? `Showed "${SUMMARY_LABELS[after.summaries[k]]}" under ${labelOf(k)}` : `Cleared the summary under ${labelOf(k)}`;
  }
  if (sumKeys.length > 1) return "Changed the summary row";
  const wKeys = Array.from(new Set([...Object.keys(before.widths), ...Object.keys(after.widths)])).filter((k) => before.widths[k] !== after.widths[k]);
  if (wKeys.length === 1) {
    const k = wKeys[0];
    const a = after.widths[k], b = before.widths[k];
    return a === undefined ? `Put ${labelOf(k)} back to its usual width` : b === undefined || a > b ? `Widened ${labelOf(k)}` : `Narrowed ${labelOf(k)}`;
  }
  return "Changed how the grid looks";
}

/**
 * Change this person's own grid look for one view (or "default" when no view
 * is chosen). Widths, frozen columns and summaries follow `column_width`;
 * row height follows `density`.
 */
export function planGridLayout(own: Partial<StaffPrefs>, viewId: string | null, patch: GridLayoutPatch, allowed: PolicyAllowed, base: GridLayout | null, labelOf: (id: string) => string): PrefPlan {
  const touchesCols = patch.widths !== undefined || patch.frozen !== undefined || patch.summaries !== undefined;
  if (touchesCols && !allowed.column_width) return locked("column_width");
  if (patch.rowHeight !== undefined && !allowed.density) return locked("density");
  if (!allowed.column_width) return locked("column_width"); // layouts are stored under this switch
  const key = layoutKeyFor(viewId);
  const layouts = { ...(own.viewLayouts ?? {}) };
  const cur = layouts[key] ?? (base ? normalizeGridLayout(base) : { ...EMPTY_GRID_LAYOUT, widths: {}, summaries: {} });
  const next: GridLayout = { widths: { ...cur.widths }, frozen: cur.frozen, rowHeight: cur.rowHeight, summaries: { ...cur.summaries } };
  for (const [c, w] of Object.entries(patch.widths ?? {})) {
    if (!isLayoutColumnId(c)) return invalid("That is not a column on People.");
    if (w === null) delete next.widths[c];
    else if (typeof w === "number" && Number.isFinite(w)) next.widths[c] = clampWidth(w);
    else return invalid("A width is a number of pixels.");
  }
  if (patch.frozen !== undefined) {
    const f = Math.round(Number(patch.frozen));
    if (!Number.isFinite(f) || f < 0 || f > MAX_FROZEN) return invalid(`Freeze up to ${MAX_FROZEN} columns.`);
    next.frozen = f;
  }
  if (patch.rowHeight !== undefined) {
    if (patch.rowHeight !== null && !isRowDensity(patch.rowHeight)) return invalid("Pick short, medium or tall rows.");
    next.rowHeight = patch.rowHeight;
  }
  for (const [c, s] of Object.entries(patch.summaries ?? {})) {
    if (!isLayoutColumnId(c)) return invalid("That is not a column on People.");
    if (s === null || s === "none") delete next.summaries[c];
    else if (isSummaryKind(s)) next.summaries[c] = s;
    else return invalid("That is not a summary the grid can show.");
  }
  const clean = normalizeGridLayout(next);
  const before = layouts[key] ?? null;
  if (same(before ?? cur, clean)) return unchanged();
  if (isEmptyGridLayout(clean)) delete layouts[key];
  else layouts[key] = clean;
  const nextOwn: Partial<StaffPrefs> = { ...own, viewLayouts: layouts };
  return {
    ok: true, nextOwn,
    change: { surface: "people", action: "grid_layout", target: `layout:${key}`, summary: gridChangeWords(before ?? cur, clean, labelOf), before, after: isEmptyGridLayout(clean) ? null : clean },
  };
}

/* ------------------------------------------------------------ a person --- */

export const PERSON_TAB_LABELS: Record<PersonTabKey, string> = {
  notes: "Notes", timeline: "Timeline", tasks: "Tasks and suggestions", referrals: "Referrals", outcomes: "Outcomes", shared: "What they shared", screen: "Their screen",
};

export function planPersonTabs(own: Partial<StaffPrefs>, tabs: readonly unknown[], allowed: PolicyAllowed): PrefPlan {
  const keys = Array.from(new Set(tabs.filter((k): k is PersonTabKey => typeof k === "string" && (PERSON_TAB_KEYS as readonly string[]).includes(k))));
  if (tabs.length && !keys.length) return invalid("Those are not tabs on a person's page.");
  return planPref(own, "personTabs", keys.length ? keys : null, allowed, "person_tabs_order", {
    surface: "person", action: "person_tabs",
    summary: keys.length ? `Put "${PERSON_TAB_LABELS[keys[0]]}" first on a person's page` : "Put a person's page tabs back in the usual order",
  });
}

/* ---------------------------------------------------------------- undo --- */

/** A logged change, as the undo planner needs it. */
export interface LoggedChange { id: string; target: string; summary: string; before: unknown; after: unknown; undoneAt: string | null; action: string }

/** Which pref keys an undo may write back (never the server-owned ones). */
const UNDOABLE_PREFS = new Set<keyof StaffPrefs>(Object.keys(DEFAULT_STAFF_PREFS) as (keyof StaffPrefs)[]);

export type UndoPlan =
  | { ok: true; kind: "pref"; key: keyof StaffPrefs; value: unknown; summary: string }
  | { ok: true; kind: "layout"; key: string; value: GridLayout | null; summary: string }
  | { ok: true; kind: "view"; viewId: string; restore: { name: string; definition: unknown } | null; summary: string }
  | PlanFail;

/** What undoing one logged change means: put its target back to `before`. */
export function planUndo(entry: LoggedChange): UndoPlan {
  if (entry.undoneAt) return { ok: false, reason: "unchanged", error: "That change was already undone." };
  const [kind, rest] = [entry.target.split(":")[0], entry.target.slice(entry.target.indexOf(":") + 1)];
  const summary = `Undid: ${entry.summary.charAt(0).toLowerCase()}${entry.summary.slice(1)}`.slice(0, 200);
  if (kind === "pref") {
    const key = rest as keyof StaffPrefs;
    if (!UNDOABLE_PREFS.has(key)) return invalid("That change cannot be undone here.");
    return { ok: true, kind: "pref", key, value: entry.before ?? null, summary };
  }
  if (kind === "layout") {
    if (rest !== "default" && !/^[0-9a-f-]{36}$/i.test(rest)) return invalid("That change cannot be undone here.");
    return { ok: true, kind: "layout", key: rest, value: entry.before ? normalizeGridLayout(entry.before) : null, summary };
  }
  if (kind === "view") {
    if (!/^[0-9a-f-]{36}$/i.test(rest)) return invalid("That change cannot be undone here.");
    const b = entry.before as { name?: unknown; definition?: unknown } | null;
    return { ok: true, kind: "view", viewId: rest, restore: b && typeof b.name === "string" ? { name: b.name, definition: b.definition ?? {} } : null, summary };
  }
  return invalid("That change cannot be undone here.");
}
