/**
 * How a list LOOKS for one person (staff build S3, 2026-10-27): column widths,
 * frozen columns, row height and the summary row of the People grid. PURE and
 * client-safe. Stored two ways, both normalized here on every read:
 *   - inside a saved view's definition (`grid`), as that view's starting look;
 *   - in a person's own prefs (`viewLayouts`, keyed by view id or "default"),
 *     so resizing a column on a shared view changes only your own screen.
 *
 * A LAYOUT NEVER WIDENS REACH OR SHOWS A HIDDEN VALUE. It sizes and summarizes
 * cells the server already sent. Sensitive values stay masked whatever a
 * layout says (the grid decides that, not this file).
 *
 * Kept apart from savedViewsShared and staffPrefsShared so both can import it
 * without an import cycle.
 */

export const ROW_DENSITIES = ["compact", "regular", "tall"] as const;
export type RowDensity = (typeof ROW_DENSITIES)[number];
export const ROW_DENSITY_LABELS: Record<RowDensity, string> = { compact: "Short rows", regular: "Medium rows", tall: "Tall rows" };
/** Row height in pixels for each density (the grid virtualizes on this). */
export const ROW_HEIGHT: Record<RowDensity, number> = { compact: 32, regular: 40, tall: 56 };
export const isRowDensity = (v: unknown): v is RowDensity => typeof v === "string" && (ROW_DENSITIES as readonly string[]).includes(v);

/**
 * Summary kinds for the row under each column. Which ones make sense depends
 * on the column's kind (summaryKindsFor); an unknown or mismatched one is
 * dropped when a layout is read.
 */
export const SUMMARY_KINDS = [
  "none", "filled", "empty", "percent_filled", "unique", "sum", "average", "min", "max", "earliest", "latest", "per_option",
] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];
export const SUMMARY_LABELS: Record<SummaryKind, string> = {
  none: "Nothing", filled: "Filled in", empty: "Empty", percent_filled: "Percent filled in", unique: "Different answers",
  sum: "Total", average: "Average", min: "Smallest", max: "Largest", earliest: "Earliest", latest: "Latest", per_option: "Count of each",
};
export const isSummaryKind = (v: unknown): v is SummaryKind => typeof v === "string" && (SUMMARY_KINDS as readonly string[]).includes(v);

/** Column ids a layout may name: the built-ins and "cf:<key>". Same rule as savedViewsShared.isViewFieldId (a test holds them equal). */
const COLUMN_ID = /^(?:name|stage|nextStep|applications|lastActive|staff|status|joined|cf:[a-z][a-z0-9_]{1,39})$/;
export const isLayoutColumnId = (v: unknown): v is string => typeof v === "string" && COLUMN_ID.test(v);

export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 640;
export const DEFAULT_COLUMN_WIDTH = 168;
export const NAME_COLUMN_WIDTH = 220;
/** Name is always first; it may be frozen with up to two more columns. */
export const MAX_FROZEN = 3;
const MAX_LAYOUT_COLUMNS = 40;

export interface GridLayout {
  /** Column id -> width in pixels. Missing = the default width. */
  widths: Record<string, number>;
  /** How many columns from the left stay put while scrolling sideways (0 to 3; name counts as one). */
  frozen: number;
  /** null = the person's usual density. */
  rowHeight: RowDensity | null;
  /** Column id -> what the summary row shows under it. */
  summaries: Record<string, SummaryKind>;
}

export const EMPTY_GRID_LAYOUT: GridLayout = { widths: {}, frozen: 1, rowHeight: null, summaries: {} };

export const clampWidth = (n: number) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(n)));

/** Keep only known keys with valid values. Never throws. */
export function normalizeGridLayout(raw: unknown): GridLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_GRID_LAYOUT, widths: {}, summaries: {} };
  const r = raw as Record<string, unknown>;
  const widths: Record<string, number> = {};
  if (r.widths && typeof r.widths === "object" && !Array.isArray(r.widths)) {
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>).slice(0, MAX_LAYOUT_COLUMNS)) {
      const n = typeof v === "number" ? v : Number(v);
      if (isLayoutColumnId(k) && Number.isFinite(n)) widths[k] = clampWidth(n);
    }
  }
  const summaries: Record<string, SummaryKind> = {};
  if (r.summaries && typeof r.summaries === "object" && !Array.isArray(r.summaries)) {
    for (const [k, v] of Object.entries(r.summaries as Record<string, unknown>).slice(0, MAX_LAYOUT_COLUMNS)) {
      if (isLayoutColumnId(k) && isSummaryKind(v) && v !== "none") summaries[k] = v;
    }
  }
  const f = typeof r.frozen === "number" ? Math.round(r.frozen) : 1;
  return {
    widths,
    frozen: Number.isFinite(f) ? Math.min(MAX_FROZEN, Math.max(0, f)) : 1,
    rowHeight: isRowDensity(r.rowHeight) ? r.rowHeight : null,
    summaries,
  };
}

/** Is this layout the same as no layout at all? (Used to keep stored prefs small.) */
export function isEmptyGridLayout(l: GridLayout): boolean {
  return Object.keys(l.widths).length === 0 && Object.keys(l.summaries).length === 0 && l.frozen === 1 && l.rowHeight === null;
}

/** A view's own layout under a person's own one: theirs wins key by key. */
export function mergeGridLayouts(base: GridLayout | null, own: GridLayout | null): GridLayout {
  const b = base ?? EMPTY_GRID_LAYOUT;
  if (!own) return { widths: { ...b.widths }, frozen: b.frozen, rowHeight: b.rowHeight, summaries: { ...b.summaries } };
  return {
    widths: { ...b.widths, ...own.widths },
    frozen: own.frozen,
    rowHeight: own.rowHeight ?? b.rowHeight,
    summaries: { ...b.summaries, ...own.summaries },
  };
}

/** The key a person's layout for a view is stored under. */
export const layoutKeyFor = (viewId: string | null | undefined) => (viewId && /^[0-9a-f-]{36}$/i.test(viewId) ? viewId.toLowerCase() : "default");
export const MAX_STORED_LAYOUTS = 40;

/** Normalize a map of layouts (prefs.viewLayouts). Keys: "default" or a view id. */
export function normalizeViewLayouts(raw: unknown): Record<string, GridLayout> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, GridLayout> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_STORED_LAYOUTS) break;
    if (k !== "default" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k)) continue;
    const l = normalizeGridLayout(v);
    if (!isEmptyGridLayout(l)) out[k] = l;
  }
  return out;
}
