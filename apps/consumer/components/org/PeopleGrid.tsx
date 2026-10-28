"use client";

/**
 * <PeopleGrid> -- People as a spreadsheet (staff build S3, 2026-10-27).
 *
 * Troy: "a table like Airtable, so a spreadsheet that they can kind of see.
 * Some people really like to see the numbers in a field that's organized like
 * that. If it's that case then they should be able to work it like a
 * spreadsheet as well."
 *
 * WHAT IT DOES
 *  - Draws only the rows on screen (virtualized), so a long caseload scrolls
 *    smoothly. Header and summary row stay put; the name column (and up to
 *    two more) can be frozen.
 *  - Keyboard first: arrows, Tab, Home/End, Page Up/Down, Shift to select a
 *    range, Enter or typing to edit, Esc to cancel, Delete to clear, Ctrl+C to
 *    copy, Ctrl+V to paste from any spreadsheet, Ctrl+Z to undo the last edit,
 *    Ctrl+Enter to open the person.
 *  - Edits only the organization's own fields, only where the viewer may
 *    write (org.note.write and the organization's grid_edit switch), for
 *    people the server already sent. Everything about the person themselves
 *    is read-only with a lock and the reason. Every value is checked here
 *    first and again on the server; a paste is all or nothing, with the reason
 *    on each cell that needs a fix.
 *  - Column resize, reorder, hide, freeze, sort, group (with counts) and a
 *    summary row per column. The arrangement belongs to the view; the look
 *    (widths, freeze, summaries, row height) is this person's own.
 *  - Sensitive fields show "Hidden" until the person chooses to show that
 *    column's answers on this screen; they are never copied while hidden.
 *
 * WHAT IT NEVER DOES: read anything (rows and values come from the caseload
 * and values reads, already reach-checked) or show anyone the server did not
 * send.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Lock, Maximize2 } from "lucide-react";
import { formatCustomFieldValue, isSensitiveField, validateCustomFieldValue, type CustomFieldDef } from "@crucible/core/src/customFieldsShared";
import { isGroupableKind, type ViewField, type ViewGroup, type ViewRow, type ViewSort } from "@crucible/core/src/savedViewsShared";
import {
  DEFAULT_COLUMN_WIDTH, MAX_FROZEN, NAME_COLUMN_WIDTH, ROW_HEIGHT, SUMMARY_LABELS, clampWidth,
  type GridLayout, type RowDensity, type SummaryKind,
} from "@crucible/core/src/viewLayoutShared";
import type { GridLayoutPatch } from "@crucible/core/src/viewActionsShared";
import {
  MASK, MASKED_REASON, NO_WRITE_REASON, POLICY_REASON, READ_ONLY_REASON, RETIRED_REASON, flattenGroups, inRange, moveCell, parseTsv, planPaste,
  rangeOf, rowLines, scrollToLine, summarize, summaryKindsFor, textToRaw, toTsv, visibleWindow,
  type CellPos, type GridLine, type PasteTarget,
} from "@/lib/people-grid";

export interface PeopleGridProps {
  groups: ViewGroup[];
  /** Columns after name, in order. */
  columns: string[];
  fields: ViewField[];
  defsByColumn: ReadonlyMap<string, CustomFieldDef>;
  staff: { id: string; name: string }[];
  layout: GridLayout;
  density: RowDensity;
  sort: ViewSort | null;
  groupBy: string | null;
  /** Fill in custom fields (org.note.write and the grid_edit switch, never read-only sessions). */
  canEdit: boolean;
  /** Why editing is off, when it is (shown on the first edit attempt). */
  editOffReason?: string;
  /** The organization lets this role arrange columns / change the look. */
  canArrange: boolean;
  canStyle: boolean;
  onLayout: (patch: GridLayoutPatch) => void;
  onColumns: (columns: string[]) => void;
  onSort: (sort: ViewSort | null) => void;
  onGroupBy: (field: string | null) => void;
  /** Values the server confirmed: person id -> field key -> value. */
  onValues: (values: Record<string, Record<string, unknown>>) => void;
  onOpen: (personId: string) => void;
  /** Built-in column cell words (dates, station, status...), the same text copy uses. */
  builtinText: (col: string, row: ViewRow) => string;
  /** Column header words. */
  labelOf: (col: string) => string;
  height?: string;
}

const ROW_HEADER = 44;
const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

type Editing = { row: number; col: number; text: string; error?: string } | null;
type UndoStep = { label: string; writes: Record<string, Record<string, unknown>> };

export function PeopleGrid(props: PeopleGridProps) {
  const {
    groups, columns, fields, defsByColumn, staff, layout, density, sort, groupBy, canEdit, editOffReason, canArrange, canStyle,
    onLayout, onColumns, onSort, onGroupBy, onValues, onOpen, builtinText, labelOf, height,
  } = props;
  const gridId = useId().replace(/:/g, "");
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CellPos>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [say, setSay] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragWidth, setDragWidth] = useState<{ col: string; width: number } | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const undo = useRef<UndoStep[]>([]);
  // Values shown, by person: what the server last confirmed plus edits in flight.
  const [pending, setPending] = useState<Record<string, Record<string, unknown>>>({});

  const lineHeight = ROW_HEIGHT[layout.rowHeight ?? density];
  const gridCols = useMemo(() => ["name", ...columns], [columns]);
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const staffNames = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  const lines = useMemo(() => flattenGroups(groups, collapsed), [groups, collapsed]);
  const dataLines = useMemo(() => rowLines(lines), [lines]);
  const rowsById = useMemo(() => new Map(groups.flatMap((g) => g.rows).map((r) => [r.id, r])), [groups]);
  const lineIndexOfRow = useMemo(() => { const m = new Map<number, number>(); let n = 0; lines.forEach((l, i) => { if (l.kind === "row") m.set(n++, i); }); return m; }, [lines]);
  const allRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const rowIndexById = useMemo(() => new Map(dataLines.map((l, i) => [l.rowId, i])), [dataLines]);

  const widthOf = useCallback((col: string) => {
    if (dragWidth?.col === col) return dragWidth.width;
    return layout.widths[col] ?? (col === "name" ? NAME_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH);
  }, [layout.widths, dragWidth]);
  const frozen = Math.min(layout.frozen, gridCols.length);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = ROW_HEADER;
    for (const c of gridCols) { out.push(x); x += widthOf(c); }
    return { at: out, total: x };
  }, [gridCols, widthOf]);

  // Keep the active cell inside the grid when rows or columns change.
  useEffect(() => {
    setActive((a) => ({ row: Math.min(a.row, Math.max(0, dataLines.length - 1)), col: Math.min(a.col, Math.max(0, gridCols.length - 1)) }));
  }, [dataLines.length, gridCols.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  /* ------------------------------------------------------------ cells ---- */

  const valueOf = useCallback((rowId: string, col: string): unknown => {
    const def = defsByColumn.get(col);
    if (def && pending[rowId] && def.key in pending[rowId]) return pending[rowId][def.key];
    return rowsById.get(rowId)?.values[col];
  }, [defsByColumn, pending, rowsById]);

  const isMasked = useCallback((col: string) => {
    const def = defsByColumn.get(col);
    return !!def && isSensitiveField(def) && !revealed.has(col);
  }, [defsByColumn, revealed]);

  /**
   * A cell's words. `forCopy`: a sensitive answer never leaves by the
   * clipboard, even after "Show" (showing is for reading on this screen; the
   * export's own tick is the only way out).
   */
  const textOf = useCallback((rowId: string, col: string, forCopy = false): string => {
    const row = rowsById.get(rowId);
    if (!row) return "";
    const def = defsByColumn.get(col);
    if (!def) return builtinText(col, row);
    const v = valueOf(rowId, col);
    if (isMasked(col) || (forCopy && isSensitiveField(def))) return isEmpty(v) ? "" : MASK;
    return formatCustomFieldValue(def, v, staffNames);
  }, [rowsById, defsByColumn, builtinText, valueOf, isMasked, staffNames]);

  /** Why this cell cannot be edited, or null when it can. */
  const lockReason = useCallback((col: string): string | null => {
    const def = defsByColumn.get(col);
    if (!def) return READ_ONLY_REASON[col] ?? "This column is read-only.";
    if (def.retiredAt) return RETIRED_REASON;
    if (!canEdit) return editOffReason ?? NO_WRITE_REASON;
    if (isMasked(col)) return MASKED_REASON;
    return null;
  }, [defsByColumn, canEdit, editOffReason, isMasked]);

  const cellId = (r: number, c: number) => `${gridId}-c-${r}-${c}`;
  const range = anchor ? rangeOf(anchor, active) : rangeOf(active, active);

  /* --------------------------------------------------------- scrolling --- */

  const bringIntoView = useCallback((row: number, col: number) => {
    const el = scroller.current;
    if (!el) return;
    const line = lineIndexOfRow.get(row) ?? 0;
    // Header row is sticky at the top: keep the cell below it.
    const top = scrollToLine(line, el.scrollTop, el.clientHeight - lineHeight * 2, lineHeight, 0);
    if (top !== el.scrollTop) el.scrollTop = top;
    const frozenWidth = frozen > 0 ? lefts.at[frozen - 1] + widthOf(gridCols[frozen - 1]) : ROW_HEADER;
    if (col >= frozen) {
      const x = lefts.at[col], w = widthOf(gridCols[col]);
      if (x - frozenWidth < el.scrollLeft) el.scrollLeft = Math.max(0, x - frozenWidth);
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    }
  }, [lineIndexOfRow, lineHeight, frozen, lefts, widthOf, gridCols]);

  const focusGrid = () => scroller.current?.focus({ preventScroll: true });

  /* ------------------------------------------------------------ saving --- */

  const saveCells = useCallback(async (writes: Record<string, Record<string, unknown>>, opts: { label: string; recordUndo?: boolean; posOf?: (rowId: string, key: string) => string | null }) => {
    const ids = Object.keys(writes);
    if (!ids.length) return true;
    // What each cell held, for Undo.
    const before: Record<string, Record<string, unknown>> = {};
    for (const id of ids) for (const key of Object.keys(writes[id])) {
      const col = `cf:${key}`;
      const prev = valueOf(id, col);
      (before[id] ??= {})[key] = isEmpty(prev) ? null : prev;
    }
    setPending((p) => { const n = { ...p }; for (const id of ids) n[id] = { ...(n[id] ?? {}), ...writes[id] }; return n; });
    setBusy(true);
    try {
      const res = await fetch("/api/org/fields/values", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity: "participant", fromGrid: true, batch: ids.map((entityId) => ({ entityId, values: writes[entityId] })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPending((p) => { const n = { ...p }; for (const id of ids) { const left = { ...(n[id] ?? {}) }; for (const k of Object.keys(writes[id])) delete left[k]; n[id] = left; } return n; });
        const errs: Record<string, string> = {};
        for (const [k, msg] of Object.entries((data.cellErrors ?? {}) as Record<string, string>)) {
          const [id, key] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
          const pos = opts.posOf?.(id, key);
          if (pos) errs[pos] = msg;
        }
        setCellErrors(errs);
        setSay({ kind: "err", text: data.error || "Nothing was saved. Try again." });
        return false;
      }
      onValues(data.values ?? {});
      setPending((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; });
      if (opts.recordUndo !== false) { undo.current.push({ label: opts.label, writes: before }); if (undo.current.length > 20) undo.current.shift(); }
      setCellErrors({});
      setSay({ kind: "ok", text: `${opts.label}. Ctrl+Z puts it back.` });
      return true;
    } catch {
      setPending((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; });
      setSay({ kind: "err", text: "Nothing was saved. Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }, [valueOf, onValues]);

  const posOf = useCallback((rowId: string, key: string) => {
    const r = rowIndexById.get(rowId) ?? -1;
    const c = gridCols.indexOf(`cf:${key}`);
    return r >= 0 && c >= 0 ? `${r}:${c}` : null;
  }, [rowIndexById, gridCols]);

  /** Check one typed value against its field, here, before anything is sent. */
  const checkText = useCallback((col: string, text: string): { ok: true; raw: unknown } | { ok: false; error: string } => {
    const def = defsByColumn.get(col);
    if (!def) return { ok: false, error: READ_ONLY_REASON[col] ?? "This column is read-only." };
    const raw = textToRaw(def, text, staff);
    const res = validateCustomFieldValue(def, raw, { staffIds: new Set(staff.map((s) => s.id.toLowerCase())) });
    return res.ok ? { ok: true, raw: res.value } : { ok: false, error: res.error };
  }, [defsByColumn, staff]);

  /* ---------------------------------------------------------- editing ---- */

  const startEdit = useCallback((row: number, col: number, initial?: string) => {
    const colId = gridCols[col];
    const why = lockReason(colId);
    if (why) { setSay({ kind: "err", text: why }); return; }
    const line = dataLines[row];
    if (!line) return;
    const def = defsByColumn.get(colId)!;
    if (def.type === "boolean") {
      const cur = valueOf(line.rowId, colId);
      void saveCells({ [line.rowId]: { [def.key]: cur === true ? false : true } }, { label: `Changed ${def.label}`, posOf });
      return;
    }
    const v = valueOf(line.rowId, colId);
    const text = initial ?? (def.type === "single_select" || def.type === "staff_member" ? String(v ?? "") : def.type === "multi_select" ? "" : isEmpty(v) ? "" : String(Array.isArray(v) ? v.join(", ") : v));
    setEditing({ row, col, text });
  }, [gridCols, lockReason, dataLines, defsByColumn, valueOf, saveCells, posOf]);

  const commitEdit = useCallback(async (raw: unknown, how: "enter" | "tab" | "shift-tab" | "blur") => {
    if (!editing) return;
    const colId = gridCols[editing.col];
    const def = defsByColumn.get(colId);
    const line = dataLines[editing.row];
    if (!def || !line) { setEditing(null); return; }
    const res = validateCustomFieldValue(def, raw, { staffIds: new Set(staff.map((s) => s.id.toLowerCase())) });
    if (!res.ok) {
      // Enter or Tab keeps the editor open with the reason; leaving the cell
      // drops the edit and says why nothing was saved.
      if (how === "blur") { setEditing(null); setSay({ kind: "err", text: `${res.error} Nothing was saved.` }); return; }
      setEditing({ ...editing, error: res.error });
      return;
    }
    const prev = valueOf(line.rowId, colId);
    const changed = JSON.stringify(isEmpty(prev) ? null : prev) !== JSON.stringify(res.value);
    const at = { row: editing.row, col: editing.col };
    setEditing(null);
    if (how !== "blur") {
      const next = how === "enter" ? moveCell(at, "ArrowDown", {}, { rows: dataLines.length, cols: gridCols.length, page: 1 })
        : moveCell(at, "Tab", { shift: how === "shift-tab" }, { rows: dataLines.length, cols: gridCols.length, page: 1 });
      if (next) { setActive(next); setAnchor(null); bringIntoView(next.row, next.col); }
      focusGrid();
    }
    if (changed) await saveCells({ [line.rowId]: { [def.key]: res.value } }, { label: `Changed ${def.label}`, posOf });
  }, [editing, gridCols, defsByColumn, dataLines, staff, valueOf, saveCells, posOf, bringIntoView]);

  /* ------------------------------------------------ copy, paste, clear --- */

  const copyText = useCallback(() => {
    const m: string[][] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const line = dataLines[r];
      if (!line) continue;
      const row: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) row.push(textOf(line.rowId, gridCols[c], true));
      m.push(row);
    }
    return toTsv(m);
  }, [range.r0, range.r1, range.c0, range.c1, dataLines, gridCols, textOf]);

  const pasteText = useCallback(async (text: string) => {
    const matrix = parseTsv(text);
    if (!matrix.length) return;
    const target = (r: number, c: number): PasteTarget | null => {
      const line = dataLines[r];
      if (!line) return null;
      const colId = gridCols[c];
      return { rowId: line.rowId, colId, key: defsByColumn.get(colId)?.key ?? null };
    };
    const plan = planPaste(matrix, range, { rows: dataLines.length, cols: gridCols.length }, target, (t, txt) => {
      const why = lockReason(t.colId);
      if (why) return { ok: false, error: why };
      return checkText(t.colId, txt);
    });
    const errs = Object.keys(plan.errors).length;
    if (errs) {
      setCellErrors(plan.errors);
      setSay({ kind: "err", text: errs === 1 ? "Nothing was pasted. One cell needs a fix: it is marked." : `Nothing was pasted. ${errs} cells need a fix: they are marked.` });
      return;
    }
    const n = Object.values(plan.writes).reduce((a, w) => a + Object.keys(w).length, 0);
    if (!n) return;
    await saveCells(plan.writes, { label: n === 1 ? "Pasted 1 cell" : `Pasted ${n} cells`, posOf });
  }, [dataLines, gridCols, defsByColumn, range, lockReason, checkText, saveCells, posOf]);

  const clearRange = useCallback(async () => {
    const single = range.r0 === range.r1 && range.c0 === range.c1;
    const writes: Record<string, Record<string, unknown>> = {};
    const errors: Record<string, string> = {};
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) {
      const line = dataLines[r];
      const colId = gridCols[c];
      if (!line) continue;
      const why = lockReason(colId);
      // In a range, cells that cannot change are skipped; one cell says why.
      if (why) { if (single) { setSay({ kind: "err", text: why }); return; } continue; }
      const def = defsByColumn.get(colId)!;
      if (isEmpty(valueOf(line.rowId, colId))) continue;
      if (def.required) { errors[`${r}:${c}`] = `${def.label} needs an answer.`; continue; }
      (writes[line.rowId] ??= {})[def.key] = null;
    }
    if (Object.keys(errors).length) { setCellErrors(errors); setSay({ kind: "err", text: `Nothing was cleared. ${Object.values(errors)[0]}` }); return; }
    const n = Object.values(writes).reduce((a, w) => a + Object.keys(w).length, 0);
    if (n) await saveCells(writes, { label: n === 1 ? "Cleared 1 cell" : `Cleared ${n} cells`, posOf });
  }, [range, dataLines, gridCols, lockReason, defsByColumn, valueOf, saveCells, posOf]);

  const undoLast = useCallback(async () => {
    const step = undo.current.pop();
    if (!step) { setSay({ kind: "ok", text: "Nothing to undo here." }); return; }
    const ok = await saveCells(step.writes, { label: `Undid: ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)}`, recordUndo: false, posOf });
    if (!ok) undo.current.push(step);
  }, [saveCells, posOf]);

  /*
   * Copy and paste. A focused grid is not an editable field, so browsers send
   * the clipboard events to the page, not to the grid: listen on the
   * document, act only while the grid itself has focus (not while a cell is
   * being typed in, where the field's own copy and paste work as usual).
   */
  const clip = useRef({ copyText, pasteText, editing: !!editing, range });
  clip.current = { copyText, pasteText, editing: !!editing, range };
  useEffect(() => {
    const mine = () => !clip.current.editing && typeof document !== "undefined" && document.activeElement === scroller.current;
    const onCopy = (e: ClipboardEvent) => {
      if (!mine() || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", clip.current.copyText());
      const r = clip.current.range;
      const n = (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1);
      setSay({ kind: "ok", text: n === 1 ? "Copied 1 cell." : `Copied ${n} cells.` });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!mine() || !e.clipboardData) return;
      e.preventDefault();
      void clip.current.pasteText(e.clipboardData.getData("text/plain"));
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => { document.removeEventListener("copy", onCopy); document.removeEventListener("paste", onPaste); };
  }, []);

  /* ------------------------------------------------------------ keys ----- */

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on a header button, the summary row or a menu are theirs, not the grid's.
    if (editing || menu || e.target !== e.currentTarget) return;
    const mod = e.ctrlKey || e.metaKey;
    const bounds = { rows: dataLines.length, cols: gridCols.length, page: Math.max(1, Math.floor(viewport / lineHeight) - 2) };
    if (!bounds.rows) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); void undoLast(); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); const l = dataLines[active.row]; if (l) onOpen(l.rowId); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setAnchor({ row: 0, col: 0 }); setActive({ row: bounds.rows - 1, col: bounds.cols - 1 }); return; }
    const next = moveCell(active, e.key, { shift: e.shiftKey, ctrl: mod }, bounds);
    if (next) {
      e.preventDefault();
      const extending = e.shiftKey && e.key !== "Tab";
      setAnchor(extending ? (anchor ?? active) : null);
      setActive(next);
      setCellErrors({});
      bringIntoView(next.row, next.col);
      return;
    }
    if (e.key === "Escape") { setAnchor(null); setCellErrors({}); setSay(null); return; }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (gridCols[active.col] === "name" && e.key === "Enter") { const l = dataLines[active.row]; if (l) onOpen(l.rowId); return; }
      startEdit(active.row, active.col);
      return;
    }
    if (e.key === " " && !mod) {
      const def = defsByColumn.get(gridCols[active.col]);
      if (def?.type === "boolean") { e.preventDefault(); startEdit(active.row, active.col); }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void clearRange(); return; }
    if (!mod && !e.altKey && e.key.length === 1) {
      const def = defsByColumn.get(gridCols[active.col]);
      if (def && ["text", "long_text", "number", "date", "url"].includes(def.type)) { e.preventDefault(); startEdit(active.row, active.col, e.key); }
      else if (def) { e.preventDefault(); startEdit(active.row, active.col); }
      else setSay({ kind: "err", text: READ_ONLY_REASON[gridCols[active.col]] ?? "This column is read-only." });
    }
  };

  /* ------------------------------------------------------- column menu --- */

  const moveColumn = (col: string, by: number) => {
    const i = columns.indexOf(col), j = i + by;
    if (i < 0 || j < 0 || j >= columns.length) return;
    const n = [...columns];
    [n[i], n[j]] = [n[j], n[i]];
    onColumns(n);
  };
  const dropColumn = (from: string, to: string) => {
    if (from === to || !canArrange) return;
    const n = columns.filter((c) => c !== from);
    const at = n.indexOf(to);
    n.splice(at < 0 ? n.length : at, 0, from);
    onColumns(n);
  };

  const startResize = (col: string, e: React.PointerEvent) => {
    if (!canStyle) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startW = widthOf(col);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    const moveTo = (ev: PointerEvent) => setDragWidth({ col, width: clampWidth(startW + ev.clientX - startX) });
    const end = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", moveTo);
      target.removeEventListener("pointerup", end);
      const w = clampWidth(startW + ev.clientX - startX);
      setDragWidth(null);
      if (w !== startW) onLayout({ widths: { [col]: w } });
    };
    target.addEventListener("pointermove", moveTo);
    target.addEventListener("pointerup", end);
  };

  /* ---------------------------------------------------------- drawing ---- */

  const win = visibleWindow(scrollTop, viewport, lineHeight, lines.length);
  const stickyLeft = (c: number) => (c < frozen ? { position: "sticky" as const, left: lefts.at[c], zIndex: 2 } : {});
  const clampClass = lineHeight >= ROW_HEIGHT.tall ? "line-clamp-2 whitespace-normal" : "truncate";
  const summaryKind = (col: string): SummaryKind => layout.summaries[col] ?? "none";

  const cellBody = (rowId: string, col: string): ReactNode => {
    const def = defsByColumn.get(col);
    const v = def ? valueOf(rowId, col) : null;
    if (def && isMasked(col)) return isEmpty(v) ? <span className="text-t-phos-dim">--</span> : <span className="inline-flex items-center gap-1 text-t-phos-dim"><Lock size={12} aria-hidden="true" />{MASK}</span>;
    const text = textOf(rowId, col);
    if (!text) return <span className="text-t-phos-dim">--</span>;
    if (def?.type === "number") return <span className="block text-right tabular-nums">{text}</span>;
    if (def?.type === "boolean") return <span>{v === true ? "Yes" : "No"}</span>;
    return <span className={clampClass}>{text}</span>;
  };

  const header = (
    <div role="row" aria-rowindex={1} className="sticky top-0 z-[4] flex border-b border-t-line-strong bg-t-panel-2" style={{ width: lefts.total, height: lineHeight }}>
      <div role="columnheader" aria-colindex={1} className="sticky left-0 z-[5] flex items-center justify-center border-r border-t-line bg-t-panel-2 text-[11px] text-t-phos-dim" style={{ width: ROW_HEADER }}>
        <span className="sr-only">Open</span>#
      </div>
      {gridCols.map((col, c) => {
        const f = fieldById.get(col);
        const sorted = sort && sort.field === col ? sort.dir : null;
        const sensitive = !!defsByColumn.get(col) && isSensitiveField(defsByColumn.get(col)!);
        return (
          <div key={col} role="columnheader" aria-colindex={c + 2} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
            draggable={col !== "name" && canArrange} onDragStart={() => setDragCol(col)} onDragOver={(e) => { if (dragCol) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragCol && col !== "name") dropColumn(dragCol, col); setDragCol(null); }} onDragEnd={() => setDragCol(null)}
            className={`group relative flex items-center gap-1 border-r border-t-line bg-t-panel-2 px-2 text-left text-xs font-semibold text-t-white ${c < frozen ? "shadow-[1px_0_0_var(--t-line-strong)]" : ""} ${dragCol && dragCol !== col ? "hover:bg-t-panel-3" : ""}`}
            style={{ width: widthOf(col), ...stickyLeft(c), zIndex: c < frozen ? 5 : undefined }}>
            <button type="button" className="t-focus min-w-0 flex-1 truncate text-left" title={labelOf(col)}
              onClick={() => onSort(sorted === "asc" ? { field: col, dir: "desc" } : sorted === "desc" ? null : { field: col, dir: "asc" })}>
              {labelOf(col)}{sensitive && <Lock size={11} className="ml-1 inline text-t-amber-bright" aria-label="Sensitive" />}
              {sorted && <span aria-hidden="true" className="ml-1 text-t-amber-bright">{sorted === "asc" ? "↑" : "↓"}</span>}
            </button>
            {f?.retired && <span className="text-[10px] font-normal text-t-phos-dim">retired</span>}
            <button type="button" aria-haspopup="menu" aria-expanded={menu === col} aria-label={`Column options for ${labelOf(col)}`}
              onClick={() => setMenu(menu === col ? null : col)} className="t-focus flex h-6 w-6 flex-none items-center justify-center text-t-phos-dim hover:text-t-white">
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {canStyle && (
              <span role="separator" aria-orientation="vertical" aria-label={`Resize ${labelOf(col)}`} onPointerDown={(e) => startResize(col, e)}
                onDoubleClick={() => onLayout({ widths: { [col]: null } })}
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-t-amber/60" />
            )}
            {menu === col && (
              <ColumnMenu col={col} index={c} field={f} isName={col === "name"} sorted={sorted} groupBy={groupBy} frozen={frozen} sensitive={sensitive} revealed={revealed.has(col)}
                canArrange={canArrange} canStyle={canStyle} summary={summaryKind(col)} isFirst={columns.indexOf(col) <= 0} isLast={columns.indexOf(col) === columns.length - 1}
                onClose={() => { setMenu(null); focusGrid(); }}
                onSort={onSort} onGroupBy={onGroupBy} onMove={(by) => moveColumn(col, by)} onHide={() => onColumns(columns.filter((x) => x !== col))}
                onFreeze={(n) => onLayout({ frozen: n })} onSummary={(k) => onLayout({ summaries: { [col]: k === "none" ? null : k } })}
                onWidth={(by) => onLayout({ widths: { [col]: by === 0 ? null : clampWidth(widthOf(col) + by) } })}
                onReveal={() => setRevealed((s) => { const n = new Set(s); if (n.has(col)) n.delete(col); else n.add(col); return n; })} />
            )}
          </div>
        );
      })}
    </div>
  );

  const groupLine = (l: Extract<GridLine, { kind: "group" }>, i: number) => (
    <div key={`g:${l.key}`} role="row" aria-rowindex={i + 2} className="flex border-b border-t-line bg-t-panel" style={{ width: lefts.total, height: lineHeight }}>
      <div role="gridcell" aria-colspan={gridCols.length + 1} className="sticky left-0 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-t-amber-bright">
        <button type="button" aria-expanded={!l.collapsed} onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(l.key)) n.delete(l.key); else n.add(l.key); return n; })}
          className="t-focus flex min-h-[28px] items-center gap-1">
          {l.collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {l.label}
        </button>
        <span className="font-term text-t-bone-dim">{l.count}</span>
      </div>
    </div>
  );

  const rowLine = (l: Extract<GridLine, { kind: "row" }>, i: number) => {
    const r = rowIndexById.get(l.rowId) ?? 0;
    const row = rowsById.get(l.rowId);
    const name = row ? String(row.values.name ?? "") : "";
    return (
      <div key={l.rowId} role="row" aria-rowindex={i + 2} className={`group/row flex border-b border-t-line ${r === active.row ? "bg-t-panel-2" : "bg-t-panel"}`} style={{ width: lefts.total, height: lineHeight }}>
        <div role="rowheader" className="sticky left-0 z-[2] flex items-center justify-between border-r border-t-line bg-inherit px-1 text-[11px] tabular-nums text-t-phos-dim" style={{ width: ROW_HEADER }}>
          <span aria-hidden="true">{r + 1}</span>
          <button type="button" tabIndex={-1} aria-label={`Open ${name || "this person"}`} onClick={() => onOpen(l.rowId)}
            className="t-focus flex h-6 w-6 items-center justify-center text-t-phos-dim opacity-0 hover:text-t-white focus:opacity-100 group-hover/row:opacity-100">
            <Maximize2 size={12} aria-hidden="true" />
          </button>
        </div>
        {gridCols.map((col, c) => {
          const sel = inRange(range, r, c);
          const isActive = r === active.row && c === active.col;
          const err = cellErrors[`${r}:${c}`];
          const locked = lockReason(col);
          const isEditing = editing && editing.row === r && editing.col === c;
          return (
            <div key={col} id={cellId(r, c)} role="gridcell" aria-colindex={c + 2} aria-selected={sel} aria-readonly={!!locked}
              aria-invalid={err ? true : undefined} title={err ?? (isActive && locked ? locked : undefined)}
              onMouseDown={(e) => {
                if (e.button !== 0 || isEditing) return;
                if (e.shiftKey) setAnchor(anchor ?? active); else setAnchor(null);
                setActive({ row: r, col: c });
                setCellErrors({});
                focusGrid();
                e.preventDefault();
              }}
              onMouseEnter={(e) => { if (e.buttons === 1 && !editing) { setAnchor((a) => a ?? active); setActive({ row: r, col: c }); } }}
              onDoubleClick={() => (col === "name" ? onOpen(l.rowId) : startEdit(r, c))}
              className={`relative flex items-center overflow-hidden border-r border-t-line px-2 text-sm ${col === "name" ? "font-medium text-t-white" : "text-t-phos"} ${sel && !isActive ? "bg-t-amber/10" : ""} ${c < frozen ? "bg-inherit" : ""} ${isActive ? "outline outline-2 -outline-offset-2 outline-t-amber" : ""} ${err ? "outline outline-2 -outline-offset-2 outline-t-red-bright" : ""}`}
              style={{ width: widthOf(col), ...stickyLeft(c) }}>
              {isEditing && editing ? (
                <CellEditor def={defsByColumn.get(col)!} editing={editing} current={valueOf(l.rowId, col)} staff={staff} lineHeight={lineHeight}
                  onCancel={() => { setEditing(null); focusGrid(); }}
                  onCommit={(raw, how) => void commitEdit(raw, how)} textToRaw={(t) => textToRaw(defsByColumn.get(col)!, t, staff)} />
              ) : (
                <>
                  <span className="min-w-0 flex-1">{cellBody(l.rowId, col)}</span>
                  {isActive && locked && !defsByColumn.get(col) && col !== "name" && <Lock size={11} className="ml-1 flex-none text-t-phos-dim" aria-hidden="true" />}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const footer = (
    <div role="row" aria-rowindex={lines.length + 2} className="sticky bottom-0 z-[4] flex border-t border-t-line-strong bg-t-panel-2" style={{ width: lefts.total, height: Math.max(lineHeight, 36) }}>
      <div role="gridcell" className="sticky left-0 z-[5] border-r border-t-line bg-t-panel-2" style={{ width: ROW_HEADER }} />
      {gridCols.map((col, c) => {
        const f = fieldById.get(col);
        const def = defsByColumn.get(col);
        const kind = col === "name" ? "none" : summaryKind(col);
        const labelFor = (v: unknown) => {
          if (def) return formatCustomFieldValue(def, def.type === "multi_select" ? [v] : v, staffNames) || String(v);
          if (f?.kind === "staff") return staffNames.get(String(v)) ?? "Not assigned";
          if (f?.options) return f.options.find((o) => o.id === String(v))?.label ?? String(v);
          if (f?.kind === "boolean") return v === true ? "Yes" : "No";
          return String(v);
        };
        const text = col === "name"
          ? `${allRows.length} ${allRows.length === 1 ? "person" : "people"}`
          : summarize(kind, allRows.map((r) => valueOf(r.id, col)), labelFor, isMasked(col));
        return (
          <div key={col} role="gridcell" aria-colindex={c + 2} className="group/sum relative flex items-center border-r border-t-line px-2 text-xs text-t-phos" style={{ width: widthOf(col), ...stickyLeft(c), zIndex: c < frozen ? 5 : undefined }}>
            {col === "name" || !f || !canStyle ? (
              <span className="truncate" title={text}>{text}</span>
            ) : (
              <label className="flex w-full min-w-0 items-center">
                <span className="sr-only">Summary for {labelOf(col)}</span>
                <select value={kind} onChange={(e) => onLayout({ summaries: { [col]: e.target.value === "none" ? null : (e.target.value as SummaryKind) } })}
                  className={`t-focus w-full min-w-0 truncate bg-transparent text-xs ${kind === "none" ? "text-transparent group-hover/sum:text-t-phos-dim focus:text-t-phos-dim" : "text-t-phos"}`}
                  title={text || "Pick a summary"}>
                  {summaryKindsFor(f.kind).map((k) => <option key={k} value={k} className="bg-t-panel text-t-white">{k === "none" ? "Summarize" : SUMMARY_LABELS[k]}</option>)}
                </select>
                {kind !== "none" && <span className="pointer-events-none absolute inset-0 flex items-center bg-t-panel-2 px-2"><span className="truncate" title={text}>{text}</span></span>}
              </label>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div data-testid="people-grid">
      <p className="sr-only" id={`${gridId}-help`}>
        Spreadsheet. Arrow keys move. Enter or start typing to change a cell; Escape cancels. Shift with arrows selects. Control C copies, Control V pastes, Delete clears, Control Z undoes. Control Enter opens the person.
      </p>
      <div
        ref={scroller}
        role="grid"
        aria-label="People, as a grid"
        aria-describedby={`${gridId}-help`}
        aria-rowcount={lines.length + 2}
        aria-colcount={gridCols.length + 1}
        aria-multiselectable="true"
        aria-busy={busy}
        aria-activedescendant={!editing && lineIndexOfRow.has(active.row) ? cellId(active.row, active.col) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="t-focus relative overflow-auto border border-t-line bg-t-panel outline-none focus-visible:ring-2 focus-visible:ring-t-amber"
        style={{ height: height ?? "max(360px, calc(100vh - 300px))" }}
      >
        {header}
        <div style={{ height: win.padTop, width: lefts.total }} aria-hidden="true" />
        {lines.slice(win.start, win.end).map((l, k) => (l.kind === "group" ? groupLine(l, win.start + k) : rowLine(l, win.start + k)))}
        <div style={{ height: win.padBottom, width: lefts.total }} aria-hidden="true" />
        {footer}
      </div>
      <div className="mt-1 flex min-h-[1.5rem] flex-wrap items-center justify-between gap-2 text-xs">
        <p role={say?.kind === "err" ? "alert" : "status"} aria-live="polite" className={say?.kind === "err" ? "text-t-amber-bright" : "text-t-phos-dim"}>
          {say?.text ?? (dataLines.length ? (canEdit ? "Click a cell, then type. Ctrl+C and Ctrl+V work with any spreadsheet." : "Click a cell to select it. Ctrl+C copies.") : "")}
        </p>
        {Object.keys(cellErrors).length > 0 && (
          <button type="button" onClick={() => setCellErrors({})} className="t-focus text-t-phos-dim underline underline-offset-4 hover:text-t-white">Clear the marks</button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the menu -- */

function ColumnMenu({ col, index, field, isName, sorted, groupBy, frozen, sensitive, revealed, canArrange, canStyle, summary, isFirst, isLast, onClose, onSort, onGroupBy, onMove, onHide, onFreeze, onSummary, onWidth, onReveal }: {
  col: string; index: number; field: ViewField | undefined; isName: boolean; sorted: "asc" | "desc" | null; groupBy: string | null; frozen: number;
  sensitive: boolean; revealed: boolean; canArrange: boolean; canStyle: boolean; summary: SummaryKind; isFirst: boolean; isLast: boolean;
  onClose: () => void; onSort: (s: ViewSort | null) => void; onGroupBy: (f: string | null) => void; onMove: (by: number) => void; onHide: () => void;
  onFreeze: (n: number) => void; onSummary: (k: SummaryKind) => void; onWidth: (by: number) => void; onReveal: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);
  const item = "t-focus flex w-full min-h-[34px] items-center px-3 text-left text-xs text-t-white hover:bg-t-panel-3 disabled:cursor-not-allowed disabled:text-t-phos-dim disabled:hover:bg-transparent";
  const act = (fn: () => void) => () => { fn(); onClose(); };
  const kind = field?.kind ?? "text";
  const words = kind === "number" ? ["Smallest first", "Largest first"] : kind === "date" ? ["Oldest first", "Newest first"] : ["A to Z", "Z to A"];
  const arrangeWhy = canArrange ? undefined : "Your organization keeps the People columns the same for everyone.";
  const styleWhy = canStyle ? undefined : "Your organization keeps the grid's columns the same for everyone.";
  return (
    <div ref={ref} role="menu" aria-label={`Options for ${field?.label ?? col}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
      className="absolute left-0 top-full z-30 mt-1 w-60 border border-t-line-strong bg-t-panel py-1 text-left font-normal shadow-lg">
      {kind !== "multi" && (
        <>
          <button role="menuitem" type="button" className={item} onClick={act(() => onSort({ field: col, dir: "asc" }))}>Sort {words[0]}{sorted === "asc" ? " (on)" : ""}</button>
          <button role="menuitem" type="button" className={item} onClick={act(() => onSort({ field: col, dir: "desc" }))}>Sort {words[1]}{sorted === "desc" ? " (on)" : ""}</button>
        </>
      )}
      {field && isGroupableKind(field.kind) && (
        <button role="menuitem" type="button" className={item} onClick={act(() => onGroupBy(groupBy === col ? null : col))}>{groupBy === col ? "Stop grouping" : "Group by this"}</button>
      )}
      {sensitive && (
        <button role="menuitem" type="button" className={item} onClick={act(onReveal)}>{revealed ? "Hide the answers again" : "Show the answers on this screen"}</button>
      )}
      <div role="separator" className="my-1 border-t border-t-line" />
      {index < MAX_FROZEN && (
        <button role="menuitem" type="button" className={item} disabled={!canStyle} title={styleWhy}
          onClick={act(() => onFreeze(frozen === index + 1 ? index : index + 1))}>
          {frozen === index + 1 ? "Unfreeze this column" : index === 0 ? "Freeze the name column" : `Freeze the first ${index + 1} columns`}
        </button>
      )}
      <button role="menuitem" type="button" className={item} disabled={!canStyle} title={styleWhy} onClick={act(() => onWidth(40))}>Wider</button>
      <button role="menuitem" type="button" className={item} disabled={!canStyle} title={styleWhy} onClick={act(() => onWidth(-40))}>Narrower</button>
      {!isName && (
        <>
          <button role="menuitem" type="button" className={item} disabled={!canArrange || isFirst} title={arrangeWhy} onClick={act(() => onMove(-1))}>Move left</button>
          <button role="menuitem" type="button" className={item} disabled={!canArrange || isLast} title={arrangeWhy} onClick={act(() => onMove(1))}>Move right</button>
          <button role="menuitem" type="button" className={item} disabled={!canArrange} title={arrangeWhy} onClick={act(onHide)}>Hide this column</button>
        </>
      )}
      {!isName && summary !== "none" && (
        <button role="menuitem" type="button" className={item} disabled={!canStyle} onClick={act(() => onSummary("none"))}>Clear the summary</button>
      )}
      {(!canArrange || !canStyle) && <p className="px-3 py-1 text-[11px] text-t-phos-dim">{arrangeWhy ?? styleWhy}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ the editor -- */

function CellEditor({ def, editing, current, staff, lineHeight, onCommit, onCancel, textToRaw }: {
  def: CustomFieldDef; editing: NonNullable<Editing>; current: unknown; staff: { id: string; name: string }[]; lineHeight: number;
  onCommit: (raw: unknown, how: "enter" | "tab" | "shift-tab" | "blur") => void; onCancel: () => void; textToRaw: (t: string) => unknown;
}) {
  const [text, setText] = useState(editing.text);
  const [multi, setMulti] = useState<string[]>(Array.isArray(current) ? current.map(String) : []);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  // One answer per edit: Enter, Tab, Escape or leaving the cell, whichever
  // comes first (unmounting a focused field can fire a late blur).
  const done = useRef(false);
  const lastKey = useRef(0);
  const commit = (raw: unknown, how: "enter" | "tab" | "shift-tab" | "blur") => { if (done.current) return; done.current = true; onCommit(raw, how); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  // A refused value keeps the editor open: let the next answer through.
  useEffect(() => { done.current = false; }, [editing]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if ("setSelectionRange" in el && typeof el.value === "string" && def.type !== "date" && def.type !== "number") { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* fine */ } }
  }, [def.type]);
  const keys = (e: React.KeyboardEvent, raw: () => unknown) => {
    e.stopPropagation();
    lastKey.current = Date.now();
    if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
    if (e.key === "Tab") { e.preventDefault(); commit(raw(), e.shiftKey ? "shift-tab" : "tab"); return; }
    if (e.key === "Enter" && !(def.type === "long_text" && e.shiftKey)) { e.preventDefault(); commit(raw(), "enter"); }
  };
  const errorLine = editing.error ? (
    <span role="alert" className="absolute left-0 top-full z-30 mt-0.5 w-64 border border-t-red-bright bg-t-panel px-2 py-1 text-xs text-t-white shadow">{editing.error}</span>
  ) : null;
  const box = "t-focus absolute inset-0 z-20 w-full border-2 border-t-amber bg-t-panel px-2 text-sm text-t-white outline-none";

  if (def.type === "single_select" || def.type === "staff_member") {
    const options = def.type === "staff_member" ? staff.map((s) => ({ id: s.id, label: s.name })) : def.options.filter((o) => !o.retired || o.id === editing.text);
    return (
      <>
        <select ref={ref} aria-label={def.label} defaultValue={editing.text} className={box}
          onKeyDown={(e) => keys(e, () => (e.currentTarget as HTMLSelectElement).value || null)}
          // A pick with the mouse saves at once; arrowing through a closed list
          // (which fires change in some browsers) waits for Enter or Tab.
          onChange={(e) => { if (Date.now() - lastKey.current > 150) commit(e.target.value || null, "blur"); }}
          onBlur={(e) => commit(e.currentTarget.value || null, "blur")}>
          <option value="">{def.required ? "Pick one" : "Nothing"}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {errorLine}
      </>
    );
  }
  if (def.type === "multi_select") {
    return (
      <div role="group" aria-label={def.label} className="absolute left-0 top-0 z-30 w-64 border-2 border-t-amber bg-t-panel p-2 shadow-lg"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") cancel(); if (e.key === "Enter") { e.preventDefault(); commit(multi, "enter"); } }}>
        <MultiPicker def={def} chosen={multi} onChange={setMulti} first={ref as unknown as React.RefObject<HTMLInputElement>} />
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => commit(multi, "enter")} className="t-focus min-h-[30px] bg-[#4f6b57] px-3 text-xs font-semibold text-white">Done</button>
          <button type="button" onClick={cancel} className="t-focus min-h-[30px] px-2 text-xs text-t-phos-dim underline">Cancel</button>
        </div>
        {errorLine}
      </div>
    );
  }
  if (def.type === "long_text") {
    return (
      <>
        <textarea ref={ref} aria-label={def.label} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={5000}
          onKeyDown={(e) => keys(e, () => textToRaw(text))} onBlur={() => commit(textToRaw(text), "blur")}
          className="t-focus absolute left-0 top-0 z-30 w-80 border-2 border-t-amber bg-t-panel p-2 text-sm text-t-white shadow-lg outline-none" style={{ minHeight: lineHeight * 3 }} />
        {errorLine}
      </>
    );
  }
  return (
    <>
      <input ref={ref} aria-label={def.label} value={text} onChange={(e) => setText(e.target.value)}
        type="text" inputMode={def.type === "number" ? "decimal" : def.type === "url" ? "url" : undefined}
        placeholder={def.type === "date" ? "10/27/2026" : def.type === "url" ? "https://" : undefined}
        maxLength={def.type === "url" ? 2000 : 500}
        onKeyDown={(e) => keys(e, () => textToRaw(text))} onBlur={() => commit(textToRaw(text), "blur")} className={box} />
      {errorLine}
    </>
  );
}

function MultiPicker({ def, chosen, onChange, first }: { def: CustomFieldDef; chosen: string[]; onChange: (ids: string[]) => void; first: React.RefObject<HTMLInputElement> }) {
  const live = def.options.filter((o) => !o.retired || chosen.includes(o.id));
  return (
    <fieldset className="max-h-48 overflow-y-auto">
      <legend className="mb-1 text-xs font-semibold text-t-white">{def.label}</legend>
      {live.map((o, i) => (
        <label key={o.id} className="flex min-h-[30px] items-center gap-2 text-xs text-t-phos">
          <input ref={i === 0 ? first : undefined} type="checkbox" className="t-focus" checked={chosen.includes(o.id)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
          {o.label}{o.retired ? " (retired)" : ""}
        </label>
      ))}
    </fieldset>
  );
}
