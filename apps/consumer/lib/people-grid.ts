/**
 * The People grid (staff build S3): the PURE half. Everything here is plain
 * functions over plain data, so the spreadsheet rules are tested without a
 * browser: which lines are on screen (virtualizing), how the active cell
 * moves on each key, ranges, copy as TSV and paste from a spreadsheet, how
 * pasted text becomes a field value, the summary row, and why a cell cannot
 * be edited.
 *
 * NOTHING HERE READS OR WRITES DATA. The grid only ever shows rows the
 * server already sent (reach-checked, consent-gated) and sends edits to the
 * values route, where core checks the capability, the person's reach and
 * every value again (all or nothing).
 */
import type { CustomFieldDef } from "@crucible/core/src/customFieldsShared";
import type { ViewField, ViewGroup } from "@crucible/core/src/savedViewsShared";
import type { SummaryKind } from "@crucible/core/src/viewLayoutShared";

/* ------------------------------------------------------- lines and window -- */

export type GridLine =
  | { kind: "group"; key: string; label: string; count: number; collapsed: boolean }
  | { kind: "row"; rowId: string; groupKey: string };

/** Groups and their rows as one list of lines (a folded group keeps its header). */
export function flattenGroups(groups: readonly Pick<ViewGroup, "key" | "label" | "rows">[], collapsed: ReadonlySet<string>): GridLine[] {
  const out: GridLine[] = [];
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0].label !== "");
  for (const g of groups) {
    const folded = grouped && collapsed.has(g.key);
    if (grouped) out.push({ kind: "group", key: g.key, label: g.label, count: g.rows.length, collapsed: folded });
    if (!folded) for (const r of g.rows) out.push({ kind: "row", rowId: r.id, groupKey: g.key });
  }
  return out;
}

/** Only the row lines, in order (what the keyboard moves over). */
export const rowLines = (lines: readonly GridLine[]) => lines.filter((l): l is Extract<GridLine, { kind: "row" }> => l.kind === "row");

/**
 * Which lines to draw for a scroll position: every line is `lineHeight` tall,
 * plus `overscan` lines above and below so fast scrolling never shows a gap.
 */
export function visibleWindow(scrollTop: number, viewport: number, lineHeight: number, total: number, overscan = 8): { start: number; end: number; padTop: number; padBottom: number } {
  if (total <= 0 || lineHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / lineHeight);
  const count = Math.ceil(Math.max(0, viewport) / lineHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + count + overscan);
  return { start, end, padTop: start * lineHeight, padBottom: (total - end) * lineHeight };
}

/** The scrollTop that brings line `index` fully into view (or the current one if it already is). */
export function scrollToLine(index: number, scrollTop: number, viewport: number, lineHeight: number, stickyTop = 0): number {
  const top = index * lineHeight;
  const bottom = top + lineHeight;
  if (top < scrollTop + stickyTop) return Math.max(0, top - stickyTop);
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}

/* ------------------------------------------------------------- the cursor -- */

export interface CellPos { row: number; col: number }
export interface GridBounds { rows: number; cols: number; page: number }

/**
 * Where the active cell goes for a key. Arrows move one cell, Tab moves right
 * (and wraps to the next row), Shift+Tab left, Home/End to the row's ends
 * (with Ctrl to the grid's corners), PageUp/PageDown by a screen. Returns null
 * for a key that does not move. Never leaves the grid.
 */
export function moveCell(pos: CellPos, key: string, mods: { shift?: boolean; ctrl?: boolean }, b: GridBounds): CellPos | null {
  if (b.rows <= 0 || b.cols <= 0) return null;
  const clampR = (r: number) => Math.min(b.rows - 1, Math.max(0, r));
  const clampC = (c: number) => Math.min(b.cols - 1, Math.max(0, c));
  const { row, col } = pos;
  switch (key) {
    case "ArrowUp": return { row: mods.ctrl ? 0 : clampR(row - 1), col };
    case "ArrowDown": return { row: mods.ctrl ? b.rows - 1 : clampR(row + 1), col };
    case "ArrowLeft": return { row, col: mods.ctrl ? 0 : clampC(col - 1) };
    case "ArrowRight": return { row, col: mods.ctrl ? b.cols - 1 : clampC(col + 1) };
    case "Tab":
      if (mods.shift) return col > 0 ? { row, col: col - 1 } : row > 0 ? { row: row - 1, col: b.cols - 1 } : { row, col };
      return col < b.cols - 1 ? { row, col: col + 1 } : row < b.rows - 1 ? { row: row + 1, col: 0 } : { row, col };
    case "Home": return mods.ctrl ? { row: 0, col: 0 } : { row, col: 0 };
    case "End": return mods.ctrl ? { row: b.rows - 1, col: b.cols - 1 } : { row, col: b.cols - 1 };
    case "PageUp": return { row: clampR(row - Math.max(1, b.page)), col };
    case "PageDown": return { row: clampR(row + Math.max(1, b.page)), col };
    default: return null;
  }
}

export interface CellRange { r0: number; c0: number; r1: number; c1: number }
/** A range from an anchor and a focus cell, any direction. */
export function rangeOf(a: CellPos, f: CellPos): CellRange {
  return { r0: Math.min(a.row, f.row), c0: Math.min(a.col, f.col), r1: Math.max(a.row, f.row), c1: Math.max(a.col, f.col) };
}
export const inRange = (r: CellRange, row: number, col: number) => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
export const rangeSize = (r: CellRange) => (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);

/* ------------------------------------------------------------------- TSV -- */

/** One cell for TSV: tabs and line breaks inside a value are quoted the way spreadsheets read them. */
function tsvCell(s: string): string {
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toTsv(matrix: readonly (readonly string[])[]): string {
  return matrix.map((row) => row.map(tsvCell).join("\t")).join("\n");
}

/**
 * Text from the clipboard as rows of cells. Reads what Excel, Google Sheets,
 * Numbers and this grid write: tab-separated, quoted cells may hold tabs,
 * quotes and line breaks. A trailing line break is not an extra row.
 */
export function parseTsv(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  let atStart = true;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; i++; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; atStart = true; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atStart = true; i++; continue; }
    cell += ch; atStart = false; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.slice(0, 2000).map((r) => r.slice(0, 100));
}

/* ------------------------------------------------- text into a field value -- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** A date a person might paste, as YYYY-MM-DD, or null. US order for 10/27/2026. */
export function parseDateText(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[1])}-${pad(+m[2])}`; }
  m = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(+m[2])}`; }
  m = /^(\d{1,2}) ([a-z]{3,9})\.? (\d{4})$/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(+m[1])}`; }
  return null;
}

/**
 * Turn typed or pasted text into the raw value the field validator expects.
 * Choices match by their label or id, any case; a pick-any list splits on
 * ";" or ","; yes/no takes yes, no, true, false, y, n, 1, 0, x; staff match
 * by name. Empty text clears. What cannot be read is passed through, so the
 * validator gives its own plain reason.
 */
export function textToRaw(def: Pick<CustomFieldDef, "type" | "options">, text: string, staff: readonly { id: string; name: string }[] = []): unknown {
  const t = text.trim();
  if (t === "") return null;
  const optionFor = (s: string) => {
    const x = s.trim().toLowerCase();
    return def.options.find((o) => o.label.trim().toLowerCase() === x && !o.retired)?.id
      ?? def.options.find((o) => o.id === x || o.label.trim().toLowerCase() === x)?.id ?? s.trim();
  };
  switch (def.type) {
    case "number": {
      const n = Number(t.replace(/[$,\s]/g, "").replace(/%$/, ""));
      return Number.isFinite(n) ? n : t;
    }
    case "boolean": {
      const x = t.toLowerCase();
      if (["yes", "y", "true", "1", "x", "checked"].includes(x)) return true;
      if (["no", "n", "false", "0", "unchecked"].includes(x)) return false;
      return t;
    }
    case "date": return parseDateText(t) ?? t;
    case "single_select": return optionFor(t);
    case "multi_select": return t.split(/[;,]/).map((p) => p.trim()).filter(Boolean).map(optionFor);
    case "staff_member": {
      const x = t.toLowerCase();
      return staff.find((s) => s.name.trim().toLowerCase() === x)?.id ?? staff.find((s) => s.id === x)?.id ?? t;
    }
    default: return text.replace(/\r\n?/g, "\n").trim();
  }
}

/* --------------------------------------------------------- read-only cells -- */

/** Why a built-in column cannot be changed here, in plain words. */
export const READ_ONLY_REASON: Record<string, string> = {
  name: "Their name comes from their own account. Only they change it.",
  stage: "Where they are comes from their own work. Only they move it.",
  nextStep: "Their next step comes from their own work.",
  applications: "Counted from the applications they share.",
  lastActive: "Set when they use their account.",
  joined: "The day they joined. It does not change.",
  staff: "Assign people from the list view or their page.",
  status: "Worked out from their activity.",
};
export const RETIRED_REASON = "This field is retired. Its old answers stay, but it takes no new ones.";
export const NO_WRITE_REASON = "You can read this field. Filling it in needs permission to write notes.";
export const POLICY_REASON = "Your organization has fields filled in on each person's page, not in the grid.";
export const MASKED_REASON = "Sensitive. Show the column's answers first.";

/* -------------------------------------------------------------- the paste -- */

export interface PasteTarget {
  rowId: string;
  colId: string;
  /** The field key for a custom column; null for a built-in column. */
  key: string | null;
}
export interface PastePlan {
  /** person id -> field key -> raw value, ready for the batch write. */
  writes: Record<string, Record<string, unknown>>;
  /** "<rowIndex>:<colIndex>" -> why that cell cannot take it. */
  errors: Record<string, string>;
  cells: number;
}

/**
 * Lay a block of pasted text over the grid from the active cell. A single
 * value pasted onto a selected range fills the whole range. Every target cell
 * is checked (editable, the text reads as a value for its field) and the plan
 * holds per-cell errors; the caller writes nothing unless there are none.
 */
export function planPaste(
  matrix: readonly (readonly string[])[],
  at: CellRange,
  bounds: { rows: number; cols: number },
  target: (row: number, col: number) => PasteTarget | null,
  cellCheck: (t: PasteTarget, text: string) => { ok: true; raw: unknown } | { ok: false; error: string },
): PastePlan {
  const writes: PastePlan["writes"] = {};
  const errors: PastePlan["errors"] = {};
  const fill = matrix.length === 1 && matrix[0].length === 1 && rangeSize(at) > 1;
  const rows = fill ? at.r1 - at.r0 + 1 : matrix.length;
  const cols = fill ? at.c1 - at.c0 + 1 : Math.max(0, ...matrix.map((r) => r.length));
  let cells = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const r = at.r0 + i, c = at.c0 + j;
      const text = fill ? matrix[0][0] : (matrix[i]?.[j] ?? "");
      if (r >= bounds.rows || c >= bounds.cols) { errors[`${r}:${c}`] = "That goes past the edge of the grid."; continue; }
      const t = target(r, c);
      if (!t) continue;
      cells++;
      const res = cellCheck(t, text);
      if (!res.ok) { errors[`${r}:${c}`] = res.error; continue; }
      if (t.key) (writes[t.rowId] ??= {})[t.key] = res.raw;
    }
  }
  return { writes, errors, cells };
}

/* -------------------------------------------------------- the summary row -- */

/** The summaries that make sense for a kind of column. */
export function summaryKindsFor(kind: ViewField["kind"]): SummaryKind[] {
  const base: SummaryKind[] = ["none", "filled", "empty", "percent_filled"];
  switch (kind) {
    case "number": return [...base, "sum", "average", "min", "max"];
    case "date": return [...base, "earliest", "latest"];
    case "choice": case "multi": case "boolean": case "staff": return [...base, "per_option"];
    default: return [...base, "unique"];
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const asDay = (v: unknown): number | null => {
  if (typeof v !== "string" || !v) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * The words under a column for the rows shown. `labelOf` turns a stored value
 * into its words (option label, staff name, Yes/No). Masked (sensitive,
 * hidden) columns only ever count.
 */
export function summarize(kind: SummaryKind, values: readonly unknown[], labelOf: (v: unknown) => string, masked = false): string {
  const n = values.length;
  const filled = values.filter((v) => !isEmpty(v));
  switch (kind) {
    case "none": return "";
    case "filled": return `${filled.length} filled in`;
    case "empty": return `${n - filled.length} empty`;
    case "percent_filled": return n ? `${Math.round((filled.length / n) * 100)}% filled in` : "0% filled in";
    default: break;
  }
  if (masked) return `${filled.length} filled in`;
  switch (kind) {
    case "unique": return `${new Set(filled.map((v) => labelOf(v).toLowerCase())).size} different`;
    case "sum": case "average": case "min": case "max": {
      const nums = filled.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (!nums.length) return "No numbers";
      if (kind === "sum") return `Total ${num(nums.reduce((a, b) => a + b, 0))}`;
      if (kind === "average") return `Average ${num(nums.reduce((a, b) => a + b, 0) / nums.length)}`;
      return `${kind === "min" ? "Smallest" : "Largest"} ${num(kind === "min" ? Math.min(...nums) : Math.max(...nums))}`;
    }
    case "earliest": case "latest": {
      const days = filled.map(asDay).filter((t): t is number => t !== null);
      if (!days.length) return "No dates";
      const t = kind === "earliest" ? Math.min(...days) : Math.max(...days);
      return `${kind === "earliest" ? "Earliest" : "Latest"} ${DATE_FMT.format(new Date(t))}`;
    }
    case "per_option": {
      const counts = new Map<string, number>();
      for (const v of filled) for (const x of Array.isArray(v) ? v : [v]) { const l = labelOf(x); counts.set(l, (counts.get(l) ?? 0) + 1); }
      if (!counts.size) return "Nothing yet";
      return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, c]) => `${l} ${c}`).join(", ");
    }
    default: return "";
  }
}

/** Masked text for a sensitive answer that is not shown. Never the value, never its length. */
export const MASK = "Hidden";
