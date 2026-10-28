/**
 * Saved views and role layouts: the PURE, client-safe half. The database
 * half is ./savedViews. Migration 104 stores a view's definition as JSON; its
 * SHAPE is owned here, and every read is normalized against an allowlist, so
 * an unknown key or a bad value in a row is dropped, never honored (the same
 * rule as staff prefs and capabilities).
 *
 * A VIEW NEVER WIDENS REACH. It only filters, sorts, groups and picks columns
 * over rows that already came from a reach-checked read. Nothing in here
 * reads data.
 */
import type { CustomFieldDef, CustomFieldType } from "./customFieldsShared";
import { CASELOAD_COLUMNS, CASELOAD_COLUMN_LABELS, CASELOAD_SORTS, TODAY_SECTION_KEYS, type SavedView as LegacySavedView, type TodaySectionKey } from "./staffPrefsShared";
import { normalizeGridLayout, type GridLayout } from "./viewLayoutShared";

export const VIEW_SURFACES = ["caseload", "today", "tasks", "outcomes", "referrals", "enrollments"] as const;
export type ViewSurface = (typeof VIEW_SURFACES)[number];
export const isViewSurface = (v: unknown): v is ViewSurface => typeof v === "string" && (VIEW_SURFACES as readonly string[]).includes(v);

/** The roles a layout or a role-default view can name. */
export const LAYOUT_ROLES = ["owner", "org_admin", "staff"] as const;
export type LayoutRole = (typeof LAYOUT_ROLES)[number];
export const LAYOUT_ROLE_LABELS: Record<LayoutRole, string> = { owner: "Owner", org_admin: "Admins", staff: "Staff" };
export const isLayoutRole = (v: unknown): v is LayoutRole => typeof v === "string" && (LAYOUT_ROLES as readonly string[]).includes(v);

export const MAX_VIEW_COLUMNS = 30;
export const MAX_VIEW_FILTERS = 20;
export const MAX_PERSONAL_VIEWS = 30;
export const MAX_SHARED_VIEWS = 30;

/* ------------------------------------------------------------- the fields -- */

/** Built-in caseload columns: the six the table always had, plus the date someone joined. "name" is always shown. */
export const BUILTIN_CASELOAD_COLUMNS = [...CASELOAD_COLUMNS, "joined"] as const;
export type BuiltinCaseloadColumn = (typeof BUILTIN_CASELOAD_COLUMNS)[number];
export const BUILTIN_COLUMN_LABELS: Record<BuiltinCaseloadColumn | "name", string> = { ...CASELOAD_COLUMN_LABELS, joined: "Joined", name: "Name" };

export type FieldKind = "text" | "number" | "date" | "boolean" | "choice" | "multi" | "staff" | "url";

export interface ViewField {
  /** "name", a built-in column id, or "cf:<key>" for a custom field. */
  id: string;
  label: string;
  kind: FieldKind;
  options?: { id: string; label: string }[];
  /** Retired custom fields stay filterable (old values are history) but are marked. */
  retired?: boolean;
  sensitive?: boolean;
}

const KIND_FOR_TYPE: Record<CustomFieldType, FieldKind> = {
  text: "text", long_text: "text", url: "url", number: "number", date: "date", boolean: "boolean",
  single_select: "choice", multi_select: "multi", staff_member: "staff",
};

export const customFieldColumnId = (key: string) => `cf:${key}`;
export const isCustomColumnId = (id: string) => /^cf:[a-z][a-z0-9_]{1,39}$/.test(id);
const isBuiltinId = (id: string): id is BuiltinCaseloadColumn | "name" => id === "name" || (BUILTIN_CASELOAD_COLUMNS as readonly string[]).includes(id);
export const isViewFieldId = (id: unknown): id is string => typeof id === "string" && (isBuiltinId(id) || isCustomColumnId(id));

/**
 * The fields a caseload view can show, filter, sort and group by: the
 * built-ins, then the participant custom fields in their order. `stations`
 * and `statuses` are the choice lists for the two built-in choice columns.
 */
export function caseloadViewFields(defs: CustomFieldDef[], ctx: { stations: { id: string; label: string }[]; statuses: { id: string; label: string }[] }): ViewField[] {
  const builtins: ViewField[] = [
    { id: "name", label: BUILTIN_COLUMN_LABELS.name, kind: "text" },
    { id: "stage", label: BUILTIN_COLUMN_LABELS.stage, kind: "choice", options: ctx.stations },
    { id: "nextStep", label: BUILTIN_COLUMN_LABELS.nextStep, kind: "text" },
    { id: "applications", label: BUILTIN_COLUMN_LABELS.applications, kind: "number" },
    { id: "lastActive", label: BUILTIN_COLUMN_LABELS.lastActive, kind: "date" },
    { id: "staff", label: BUILTIN_COLUMN_LABELS.staff, kind: "staff" },
    { id: "status", label: BUILTIN_COLUMN_LABELS.status, kind: "choice", options: ctx.statuses },
    { id: "joined", label: BUILTIN_COLUMN_LABELS.joined, kind: "date" },
  ];
  const custom = defs
    .filter((d) => d.entity === "participant")
    .sort((a, b) => Number(!!a.retiredAt) - Number(!!b.retiredAt) || a.position - b.position || a.label.localeCompare(b.label))
    .map((d): ViewField => ({
      id: customFieldColumnId(d.key), label: d.label, kind: KIND_FOR_TYPE[d.type],
      ...(d.options.length ? { options: d.options.map((o) => ({ id: o.id, label: o.label })) } : {}),
      ...(d.retiredAt ? { retired: true } : {}), ...(d.sensitive ? { sensitive: true } : {}),
    }));
  return [...builtins, ...custom];
}

/* ------------------------------------------------------------ the filters -- */

export const FILTER_OPS: Record<FieldKind, readonly string[]> = {
  text: ["contains", "is_empty", "is_set"],
  url: ["contains", "is_empty", "is_set"],
  number: ["eq", "gt", "lt", "is_empty", "is_set"],
  date: ["before", "after", "within_days", "older_than_days", "is_empty", "is_set"],
  boolean: ["is_true", "is_false", "is_empty"],
  choice: ["any_of", "none_of", "is_empty", "is_set"],
  multi: ["has_any", "has_all", "is_empty", "is_set"],
  staff: ["any_of", "is_empty", "is_set"],
};
export const FILTER_OP_LABELS: Record<string, string> = {
  contains: "contains", is_empty: "is empty", is_set: "has a value", eq: "is", gt: "is more than", lt: "is less than",
  before: "is before", after: "is after", within_days: "in the last ... days", older_than_days: "more than ... days ago",
  is_true: "is yes", is_false: "is no", any_of: "is any of", none_of: "is none of", has_any: "includes any of", has_all: "includes all of",
};
const ALL_OPS = new Set(Object.values(FILTER_OPS).flat());
const NO_VALUE = new Set(["is_empty", "is_set", "is_true", "is_false"]);
const LIST_OPS = new Set(["any_of", "none_of", "has_any", "has_all"]);
const NUM_OPS = new Set(["eq", "gt", "lt", "within_days", "older_than_days"]);
const DATE_OPS = new Set(["before", "after"]);

export interface ViewFilter { field: string; op: string; value?: string | number | string[] }
export interface ViewSort { field: string; dir: "asc" | "desc" }

export interface ViewDefinition {
  /** Column ids in order. null = the default columns (role layout, then built-ins). */
  columns: string[] | null;
  filters: ViewFilter[];
  /** A field, or a preset sort ("needs_attention" ...). null = the default sort. */
  sort: ViewSort | null;
  groupBy: string | null;
  /**
   * The grid's look saved with the view (widths, frozen columns, row height,
   * summary row): where the view starts for everyone who opens it. Each
   * person's own resizing is kept in their prefs (viewLayouts), never here,
   * unless they save the view. null = the plain look.
   */
  grid?: GridLayout | null;
}
export const EMPTY_VIEW: ViewDefinition = { columns: null, filters: [], sort: null, groupBy: null };

const PRESET_SORTS: readonly string[] = CASELOAD_SORTS;
const cleanText = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export function normalizeViewFilter(raw: unknown): ViewFilter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isViewFieldId(r.field) || typeof r.op !== "string" || !ALL_OPS.has(r.op)) return null;
  const f: ViewFilter = { field: r.field, op: r.op };
  if (NO_VALUE.has(r.op)) return f;
  if (LIST_OPS.has(r.op)) {
    if (!Array.isArray(r.value)) return null;
    const list = Array.from(new Set(r.value.filter((x): x is string => typeof x === "string").map((x) => cleanText(x, 60)).filter(Boolean))).slice(0, 100);
    return list.length ? { ...f, value: list } : null;
  }
  if (NUM_OPS.has(r.op)) {
    const n = typeof r.value === "number" ? r.value : Number(r.value);
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) return null;
    if ((r.op === "within_days" || r.op === "older_than_days") && (n < 0 || n > 3650)) return null;
    return { ...f, value: n };
  }
  if (DATE_OPS.has(r.op)) {
    return typeof r.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.value) ? { ...f, value: r.value } : null;
  }
  const s = cleanText(r.value);
  return s ? { ...f, value: s } : null;
}

/** Keep only known keys with valid values. Never throws. */
export function normalizeViewDefinition(raw: unknown): ViewDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_VIEW };
  const r = raw as Record<string, unknown>;
  const columns = Array.isArray(r.columns)
    ? Array.from(new Set(r.columns.filter(isViewFieldId).filter((c) => c !== "name"))).slice(0, MAX_VIEW_COLUMNS)
    : null;
  const filters = Array.isArray(r.filters) ? r.filters.map(normalizeViewFilter).filter((f): f is ViewFilter => !!f).slice(0, MAX_VIEW_FILTERS) : [];
  let sort: ViewSort | null = null;
  if (r.sort && typeof r.sort === "object" && !Array.isArray(r.sort)) {
    const s = r.sort as Record<string, unknown>;
    if (typeof s.field === "string" && (isViewFieldId(s.field) || PRESET_SORTS.includes(s.field))) sort = { field: s.field, dir: s.dir === "desc" ? "desc" : "asc" };
  }
  const groupBy = isViewFieldId(r.groupBy) && r.groupBy !== "name" ? r.groupBy : null;
  const out: ViewDefinition = { columns, filters, sort, groupBy };
  if (r.grid && typeof r.grid === "object" && !Array.isArray(r.grid)) out.grid = normalizeGridLayout(r.grid);
  return out;
}

/** Two definitions mean the same arrangement (the grid's look is not part of it: resizing never makes a view "changed"). */
export function sameArrangement(a: ViewDefinition, b: ViewDefinition): boolean {
  const strip = (d: ViewDefinition) => { const n = normalizeViewDefinition(d); return JSON.stringify({ columns: n.columns, filters: n.filters, sort: n.sort, groupBy: n.groupBy }); };
  return strip(a) === strip(b);
}

/** A saved name: one line, 1 to 60 characters. */
export function cleanViewName(raw: unknown): string | null {
  const s = cleanText(raw, 60).replace(/\s+/g, " ");
  return s.length ? s : null;
}

/**
 * The old saved sorts (users.staff_prefs.savedViews, 052) as definitions.
 * Same meaning: a sort, a status, a staff member (or "nobody").
 */
export function legacyViewToDefinition(v: LegacySavedView): ViewDefinition {
  const filters: ViewFilter[] = [];
  if (v.status) filters.push({ field: "status", op: "any_of", value: [v.status] });
  if (v.staffId === "__unassigned__") filters.push({ field: "staff", op: "is_empty" });
  else if (v.staffId) filters.push({ field: "staff", op: "any_of", value: [v.staffId] });
  return { columns: null, filters, sort: v.sort && v.sort !== "needs_attention" ? { field: v.sort, dir: "asc" } : { field: "needs_attention", dir: "asc" }, groupBy: null };
}

/* ------------------------------------------------------------- the engine -- */

/** One row as the engine sees it: values by field id ("name", "stage", "cf:housing" ...). */
export interface ViewRow { id: string; values: Record<string, unknown> }

const DAY = 86400000;
function asTime(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
const isEmptyValue = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Does one row pass one filter? Unknown fields pass (a retired or removed field never hides people). */
export function rowMatchesFilter(row: ViewRow, f: ViewFilter, fields: Map<string, ViewField>, nowMs: number): boolean {
  const field = fields.get(f.field);
  if (!field) return true;
  const v = row.values[f.field];
  switch (f.op) {
    case "is_empty": return isEmptyValue(v);
    case "is_set": return !isEmptyValue(v);
    case "is_true": return v === true;
    case "is_false": return v === false;
    case "contains": {
      const needle = String(f.value ?? "").toLowerCase();
      return !isEmptyValue(v) && String(v).toLowerCase().includes(needle);
    }
    case "eq": return typeof v === "number" && v === f.value;
    case "gt": return typeof v === "number" && v > Number(f.value);
    case "lt": return typeof v === "number" && v < Number(f.value);
    case "before": { const t = asTime(v), x = asTime(f.value); return t !== null && x !== null && t < x; }
    case "after": { const t = asTime(v), x = asTime(f.value); return t !== null && x !== null && t >= x + DAY; }
    case "within_days": { const t = asTime(v); return t !== null && nowMs - t <= Number(f.value) * DAY; }
    case "older_than_days": { const t = asTime(v); return t !== null && nowMs - t > Number(f.value) * DAY; }
    case "any_of": return Array.isArray(f.value) && !isEmptyValue(v) && f.value.includes(String(v));
    case "none_of": return Array.isArray(f.value) && (isEmptyValue(v) || !f.value.includes(String(v)));
    case "has_any": return Array.isArray(f.value) && Array.isArray(v) && v.some((x) => (f.value as string[]).includes(String(x)));
    case "has_all": return Array.isArray(f.value) && Array.isArray(v) && (f.value as string[]).every((x) => v.map(String).includes(x));
    default: return true;
  }
}

function compareValues(a: unknown, b: unknown, kind: FieldKind, labelOf: (v: unknown) => string): number {
  const ea = isEmptyValue(a), eb = isEmptyValue(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empties last, whichever direction
  if (kind === "number") return Number(a) - Number(b);
  if (kind === "date") return (asTime(a) ?? 0) - (asTime(b) ?? 0);
  if (kind === "boolean") return Number(b === true) - Number(a === true);
  if (kind === "choice") return 0; // ordered by option position below
  return labelOf(a).localeCompare(labelOf(b), "en", { sensitivity: "base" });
}

export interface ApplyViewContext {
  fields: ViewField[];
  nowMs: number;
  /** Comparators for the preset sorts ("needs_attention" ...). */
  presetSorts?: Record<string, (a: ViewRow, b: ViewRow) => number>;
  /** Default sort when the view has none. */
  defaultSort?: (a: ViewRow, b: ViewRow) => number;
  /** Staff id -> name, for grouping and text sorting of staff fields. */
  staffNames?: ReadonlyMap<string, string>;
  /** Free-text "find by name", applied on top of the view. */
  find?: string;
}

export interface ViewGroup { key: string; label: string; rows: ViewRow[] }

/** Filter, then sort. Pure; the input array is not changed. */
export function applyView(rows: ViewRow[], def: ViewDefinition, ctx: ApplyViewContext): ViewRow[] {
  const fields = new Map(ctx.fields.map((f) => [f.id, f]));
  const find = (ctx.find ?? "").trim().toLowerCase();
  const out = rows.filter((r) =>
    (!find || String(r.values.name ?? "").toLowerCase().includes(find))
    && def.filters.every((f) => rowMatchesFilter(r, f, fields, ctx.nowMs)));
  const byName = (a: ViewRow, b: ViewRow) => String(a.values.name ?? "").localeCompare(String(b.values.name ?? ""), "en", { sensitivity: "base" });
  const s = def.sort;
  if (s && ctx.presetSorts?.[s.field]) {
    const cmp = ctx.presetSorts[s.field];
    out.sort((a, b) => cmp(a, b) || byName(a, b));
  } else if (s && fields.has(s.field)) {
    const field = fields.get(s.field)!;
    const optIndex = new Map((field.options ?? []).map((o, i) => [o.id, i]));
    const labelOf = (v: unknown) => field.kind === "staff" ? (ctx.staffNames?.get(String(v)) ?? String(v)) : Array.isArray(v) ? v.join(",") : String(v);
    const sign = s.dir === "desc" ? -1 : 1;
    out.sort((a, b) => {
      const va = a.values[s.field], vb = b.values[s.field];
      const ea = isEmptyValue(va), eb = isEmptyValue(vb);
      if (ea || eb) return ea === eb ? byName(a, b) : ea ? 1 : -1;
      const c = field.kind === "choice" ? (optIndex.get(String(va)) ?? 999) - (optIndex.get(String(vb)) ?? 999) : compareValues(va, vb, field.kind, labelOf);
      return sign * c || byName(a, b);
    });
  } else if (ctx.defaultSort) {
    out.sort((a, b) => ctx.defaultSort!(a, b) || byName(a, b));
  }
  return out;
}

/** Fields that make sense as groups: one value per row. */
export const isGroupableKind = (k: FieldKind) => k === "choice" || k === "boolean" || k === "staff";

/** Group already-sorted rows by one field; groups in option order, "Not set" last. Rows keep their order inside a group. */
export function groupRows(rows: ViewRow[], groupBy: string | null, ctx: Pick<ApplyViewContext, "fields" | "staffNames">): ViewGroup[] {
  const field = groupBy ? ctx.fields.find((f) => f.id === groupBy) : undefined;
  if (!field || !isGroupableKind(field.kind)) return [{ key: "", label: "", rows }];
  const groups = new Map<string, ViewGroup>();
  const labelFor = (v: unknown): string => {
    if (isEmptyValue(v)) return field.kind === "staff" ? "Not assigned" : "Not set";
    if (field.kind === "boolean") return v === true ? "Yes" : "No";
    if (field.kind === "staff") return ctx.staffNames?.get(String(v)) ?? "Someone no longer on staff";
    return field.options?.find((o) => o.id === String(v))?.label ?? String(v);
  };
  for (const r of rows) {
    const v = r.values[field.id];
    const key = isEmptyValue(v) ? "" : String(v);
    if (!groups.has(key)) groups.set(key, { key, label: labelFor(v), rows: [] });
    groups.get(key)!.rows.push(r);
  }
  const order = new Map((field.options ?? []).map((o, i) => [o.id, i]));
  const rank = (g: ViewGroup) => g.key === "" ? 1e9 : field.kind === "boolean" ? (g.key === "true" ? 0 : 1) : (order.get(g.key) ?? 1e6);
  return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/* ----------------------------------------------------------- role layouts -- */

export interface TodayLayout { order: TodaySectionKey[]; hidden: TodaySectionKey[] }
export interface CaseloadLayout { columns: string[] }

export function normalizeTodayLayout(raw: unknown): TodayLayout {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const keep = (v: unknown) => Array.isArray(v) ? Array.from(new Set(v.filter((k): k is TodaySectionKey => typeof k === "string" && (TODAY_SECTION_KEYS as readonly string[]).includes(k)))) : [];
  return { order: keep(r.order), hidden: keep(r.hidden) };
}

export function normalizeCaseloadLayout(raw: unknown): CaseloadLayout {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { columns: Array.isArray(r.columns) ? Array.from(new Set(r.columns.filter(isViewFieldId).filter((c) => c !== "name"))).slice(0, MAX_VIEW_COLUMNS) : [] };
}

/**
 * Today's sections for a role: the layout's order first, then any section it
 * does not mention in code order (so a section added later shows up instead
 * of vanishing), minus the ones the role hides.
 */
export function resolveTodaySections<K extends string>(all: readonly K[], layout: { order: readonly string[]; hidden: readonly string[] } | null): K[] {
  if (!layout) return [...all];
  const known = new Set<string>(all);
  const first = layout.order.filter((k): k is K => known.has(k));
  const rest = all.filter((k) => !first.includes(k));
  return [...first, ...rest].filter((k) => !layout.hidden.includes(k));
}

/**
 * The columns a caseload shows when no view is chosen: the role's layout if
 * the org set one, else every built-in, minus what the person hid for
 * themselves (Settings, My workflow).
 */
export function defaultCaseloadColumns(layout: CaseloadLayout | null, personalHidden: readonly string[], personalColumns: readonly string[] | null = null): string[] {
  // A person's own column list (prefs.caseloadColumns, when the organization
  // lets them choose) wins over the role's layout.
  if (personalColumns && personalColumns.length) return personalColumns.filter((c) => c !== "name");
  const base = layout && layout.columns.length ? layout.columns : [...BUILTIN_CASELOAD_COLUMNS];
  return base.filter((c) => !personalHidden.includes(c));
}

/**
 * Which view opens first for a person: the one they chose last (if it still
 * exists), else a shared view set as their role's default, else none.
 */
export function initialViewId(views: { id: string; ownerUserId: string | null; roleDefault: string | null; position: number }[], role: string, lastChosen: string | null, chosenDefault: string | null = null): string | null {
  // An explicit "open People with this view" (prefs.defaultView) comes first.
  if (chosenDefault === "none") return null;
  if (chosenDefault && views.some((v) => v.id === chosenDefault)) return chosenDefault;
  if (lastChosen === "" ) return null;
  if (lastChosen && views.some((v) => v.id === lastChosen)) return lastChosen;
  const def = views.filter((v) => v.ownerUserId === null && v.roleDefault === role).sort((a, b) => a.position - b.position)[0];
  return def?.id ?? null;
}
