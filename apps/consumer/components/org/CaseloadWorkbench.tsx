"use client";

/**
 * <CaseloadWorkbench> -- the caseload you can arrange (house build L4).
 *
 * Pick the columns (built-in and your organization's own fields), filter on
 * any of them, sort, group, and save the arrangement as a view: yours, or
 * shared with everyone (people who manage settings), optionally the first
 * view a role sees. The view menu holds both. ?view=<id> in the address opens
 * a view, so a view can be linked.
 *
 * WHAT A VIEW CANNOT DO: show anyone the server did not already send. Rows
 * come from the consent-gated, reach-checked caseload read; custom field
 * values from the reach-checked values read. The engine (core,
 * savedViewsShared) only filters, sorts and groups what is here.
 *
 * Sensitive fields show to staff who reach the person (they are org records),
 * and are marked; they leave in an export only when ticked.
 *
 * STAFF BUILD S3 (2026-10-27): a Grid mode beside the list (PeopleGrid, a
 * spreadsheet over the same rows and the same view), the person's own look
 * per view (widths, frozen columns, summaries, row height; saved for them
 * alone through the view action layer, logged and undoable), a view they can
 * make People open with, and the organization's limits on what their role may
 * change for themselves (migration 108), drawn locked with the reason. On a
 * phone the grid falls back to the list.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PeopleGrid } from "@/components/org/PeopleGrid";
import { VIEW_CHANGED_EVENT } from "@/lib/view-change-events";
import { mergeGridLayouts, layoutKeyFor, type GridLayout, type RowDensity } from "@crucible/core/src/viewLayoutShared";
import type { GridLayoutPatch } from "@crucible/core/src/viewActionsShared";
import type { PolicyAllowed } from "@crucible/core/src/customizationPolicyShared";
import {
  EMPTY_VIEW, FILTER_OPS, FILTER_OP_LABELS, LAYOUT_ROLES, LAYOUT_ROLE_LABELS, applyView, caseloadViewFields, defaultCaseloadColumns, groupRows,
  initialViewId, isGroupableKind, normalizeViewDefinition, sameArrangement,
  type ViewDefinition, type ViewField, type ViewFilter, type ViewRow,
} from "@crucible/core/src/savedViewsShared";
import { formatCustomFieldValue, isSensitiveField, type CustomFieldDef } from "@crucible/core/src/customFieldsShared";
import { CASELOAD_SORTS, CASELOAD_SORT_LABELS, type CaseloadSort } from "@crucible/core/src/staffPrefsShared";

export interface WorkbenchClient {
  userId: string; name: string | null; email: string | null; currentStage: number; nextStepAction: string | null;
  applications: number; lastActiveAt: string | null; joinedAt: string; assignedStaffId: string | null; assignedStaffName: string | null;
}

interface SavedViewRecord { id: string; name: string; ownerUserId: string | null; roleDefault: string | null; position: number; definition: ViewDefinition }
interface ViewsPayload {
  views: SavedViewRecord[]; role: string; canShare: boolean; canExport: boolean; roleColumns: string[] | null; personalHidden: string[]; defaultSort: CaseloadSort;
  // S3: the person's own choices and their role's limits (absent on an older server: everything allowed, list mode).
  personalColumns?: string[] | null; defaultView?: string | null; density?: RowDensity; mode?: "list" | "grid";
  layouts?: Record<string, GridLayout>; allowed?: Partial<PolicyAllowed>; canEditValues?: boolean;
}
interface ValuesPayload { defs: CustomFieldDef[]; values: Record<string, Record<string, unknown>>; staff: { id: string; name: string }[] }

const VIEW_KEY = "smr.caseload.view";
const readStored = (): string | null => { try { return window.localStorage.getItem(VIEW_KEY); } catch { return null; } };
const writeStored = (v: string) => { try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private window: fine */ } };
const sameDef = (a: ViewDefinition, b: ViewDefinition) => sameArrangement(a, b);
const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDay = (v: unknown) => { if (typeof v !== "string" || !v) return ""; const t = Date.parse(v); return Number.isFinite(t) ? DATE_FMT.format(new Date(t)) : ""; };

/** True on screens wide enough for the grid (the grid falls back to the list on a phone). */
function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const set = () => setWide(mq.matches);
    set();
    mq.addEventListener?.("change", set);
    return () => mq.removeEventListener?.("change", set);
  }, []);
  return wide;
}

/** One person's own grid look, saved behind the screen: changes made within a moment go as one. */
function useLayoutSaver(readOnly: boolean, onSaved: (summary: string) => void) {
  const queue = useRef<{ viewId: string | null; patch: GridLayoutPatch } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    const q = queue.current;
    queue.current = null;
    if (!q || readOnly) return;
    fetch("/api/org/prefs/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "setGridLayout", viewId: q.viewId, patch: q.patch }) })
      .then((r) => r.json().catch(() => ({})).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (!ok && d?.reason !== "unchanged") onSaved(d?.error || "That look was not saved. It stays on this screen."); })
      .catch(() => { /* kept on screen; not saved */ });
  }, [readOnly, onSaved]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); flush(); }, [flush]);
  return useCallback((viewId: string | null, patch: GridLayoutPatch) => {
    const q = queue.current && queue.current.viewId === viewId ? queue.current.patch : (queue.current ? (flush(), {}) : {});
    queue.current = {
      viewId,
      patch: {
        ...q, ...patch,
        widths: patch.widths || q.widths ? { ...(q.widths ?? {}), ...(patch.widths ?? {}) } : undefined,
        summaries: patch.summaries || q.summaries ? { ...(q.summaries ?? {}), ...(patch.summaries ?? {}) } : undefined,
      },
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  }, [flush]);
}

const btn = "t-focus inline-flex min-h-touch items-center gap-1 border border-t-line bg-t-panel px-3 text-xs text-t-phos hover:border-t-line-strong hover:text-t-white";
const btnOn = "t-focus inline-flex min-h-touch items-center gap-1 border border-t-amber bg-t-panel px-3 text-xs text-t-white";
const input = "t-focus bg-t-panel border border-t-line text-xs text-t-white px-2 py-1.5";

type Panel = null | "columns" | "filters" | "sort" | "group" | "save" | "export";

export function CaseloadWorkbench<T extends WorkbenchClient>({
  clients, statusOf, statusOptions, stationOptions, stationIdOf, presetSorts, renderBuiltin, showStaffColumn,
  pickable, picked, onPick, empty, trailing, labels, readOnly = false,
}: {
  clients: T[];
  statusOf: (c: T) => string;
  statusOptions: { id: string; label: string }[];
  stationOptions: { id: string; label: string }[];
  stationIdOf: (c: T) => string | null;
  presetSorts: Record<CaseloadSort, (a: T, b: T) => number>;
  /** The table cell for a built-in column, drawn by the caller (assign menus, badges). */
  renderBuiltin: (column: string, c: T) => ReactNode;
  showStaffColumn: boolean;
  pickable: boolean;
  picked: Set<string>;
  onPick: (next: Set<string>) => void;
  empty: ReactNode;
  /** Column names in the organization's own words (built-in id -> label). */
  labels?: Partial<Record<string, string>>;
  /** Read-only sessions (view-as, the admin's org view): arrange and filter, never save, share or export. */
  readOnly?: boolean;
  /** A last column the caller always draws (the owner's AI cost), outside views. */
  trailing?: { label: string; render: (c: T) => ReactNode } | null;
}) {
  const [meta, setMeta] = useState<ViewsPayload | null>(null);
  const [vals, setVals] = useState<ValuesPayload>({ defs: [], values: {}, staff: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ViewDefinition>(EMPTY_VIEW);
  const [find, setFind] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [now] = useState(() => Date.now());
  const [mode, setModeState] = useState<"list" | "grid">("list");
  const [localLayouts, setLocalLayouts] = useState<Record<string, GridLayout>>({});
  const router = useRouter();
  const wide = useWide();
  const saveLayout = useLayoutSaver(readOnly, useCallback((text: string) => setMsg({ kind: "err", text }), []));

  const load = useCallback(async () => {
    const [v, f] = await Promise.all([
      fetch("/api/org/views?surface=caseload", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/org/fields/values?entity=participant", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (f) setVals({ defs: f.defs ?? [], values: f.values ?? {}, staff: f.staff ?? [] });
    if (v) {
      setMeta(v);
      return v as ViewsPayload;
    }
    return null;
  }, []);

  useEffect(() => {
    // Move the old saved sorts over once (a write, so a POST; read-only
    // view-as refuses it and the list still loads), then read.
    (readOnly ? Promise.resolve({ ok: false } as Response) : fetch("/api/org/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "move_legacy" }) }))
      .then((r) => (r.ok ? r.json() : { moved: 0 })).catch(() => ({ moved: 0 }))
      .then((m: { moved?: number }) => load().then((v) => ({ v, moved: m?.moved ?? 0 })))
      .then(({ v, moved }) => {
      if (!v) return;
      const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
      // A link (?view=) wins; then the view this person chose to open People with; then the last one; then the role's.
      const id = initialViewId(v.views, v.role, fromUrl ?? readStored(), fromUrl ? null : v.defaultView ?? null);
      if (v.mode) setModeState(v.mode);
      const chosen = v.views.find((x) => x.id === id);
      setActiveId(chosen?.id ?? null);
      setDraft(chosen ? chosen.definition : EMPTY_VIEW);
      if (moved > 0) setMsg({ kind: "ok", text: moved === 1 ? "Your saved view moved to the view menu." : `Your ${moved} saved views moved to the view menu.` });
    });
  }, [load, readOnly]);

  // t.ROY changed this person's own view (the chat's Done card fires this): read it again.
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener(VIEW_CHANGED_EVENT, again);
    return () => window.removeEventListener(VIEW_CHANGED_EVENT, again);
  }, [load]);

  const defsById = useMemo(() => new Map(vals.defs.map((d) => [`cf:${d.key}`, d])), [vals.defs]);
  const staffNames = useMemo(() => new Map(vals.staff.map((s) => [s.id, s.name])), [vals.staff]);
  const fields: ViewField[] = useMemo(() => {
    const all = caseloadViewFields(vals.defs, { stations: stationOptions, statuses: statusOptions })
      .map((f) => (labels?.[f.id] ? { ...f, label: labels[f.id]! } : f));
    return showStaffColumn ? all : all.filter((f) => f.id !== "staff");
  }, [vals.defs, stationOptions, statusOptions, showStaffColumn, labels?.staff]); // eslint-disable-line react-hooks/exhaustive-deps
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  const byId = useMemo(() => new Map(clients.map((c) => [c.userId, c])), [clients]);
  const rows: ViewRow[] = useMemo(() => clients.map((c) => {
    const values: Record<string, unknown> = {
      name: c.name ?? "", stage: stationIdOf(c), nextStep: c.nextStepAction ?? "", applications: c.applications,
      lastActive: c.lastActiveAt, staff: c.assignedStaffId, status: statusOf(c), joined: c.joinedAt,
    };
    const mine = vals.values[c.userId] ?? {};
    for (const d of vals.defs) values[`cf:${d.key}`] = mine[d.key] ?? null;
    return { id: c.userId, values };
  }), [clients, vals, statusOf, stationIdOf]);

  const wrapSort = (cmp: (a: T, b: T) => number) => (a: ViewRow, b: ViewRow) => cmp(byId.get(a.id)!, byId.get(b.id)!);
  const presetRowSorts = Object.fromEntries(CASELOAD_SORTS.map((k) => [k, wrapSort(presetSorts[k])]));
  const defaultSort = presetRowSorts[meta?.defaultSort ?? "needs_attention"];
  const shown = applyView(rows, draft, { fields, nowMs: now, presetSorts: presetRowSorts, defaultSort, staffNames, find });
  const groups = groupRows(shown, draft.groupBy, { fields, staffNames });

  const columns = (draft.columns ?? defaultCaseloadColumns(meta?.roleColumns ? { columns: meta.roleColumns } : null, meta?.personalHidden ?? [], meta?.personalColumns ?? null))
    .filter((c) => fieldById.has(c) && c !== "name");
  const active = meta?.views.find((v) => v.id === activeId) ?? null;
  const allowed = { personal_views: true, columns: true, column_width: true, density: true, default_view: true, grid_edit: true, ...(meta?.allowed ?? {}) };
  // Managers arrange shared views whatever the personal limits say.
  const canArrange = allowed.columns || !!meta?.canShare;
  const layoutKey = layoutKeyFor(activeId);
  const layout = mergeGridLayouts(active?.definition.grid ?? null, localLayouts[layoutKey] ?? meta?.layouts?.[layoutKey] ?? null);
  const showGrid = mode === "grid" && wide;
  function setMode(next: "list" | "grid") {
    setModeState(next);
    if (!readOnly) fetch("/api/org/prefs/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "setPeopleMode", mode: next }) }).catch(() => {});
  }
  function changeLayout(patch: GridLayoutPatch) {
    const base = localLayouts[layoutKey] ?? meta?.layouts?.[layoutKey] ?? active?.definition.grid ?? null;
    const cur = mergeGridLayouts(null, base);
    const next: GridLayout = {
      widths: { ...cur.widths }, frozen: patch.frozen ?? cur.frozen, rowHeight: patch.rowHeight !== undefined ? patch.rowHeight : cur.rowHeight, summaries: { ...cur.summaries },
    };
    for (const [k, w] of Object.entries(patch.widths ?? {})) { if (w === null) delete next.widths[k]; else next.widths[k] = w; }
    for (const [k, v] of Object.entries(patch.summaries ?? {})) { if (v === null) delete next.summaries[k]; else next.summaries[k] = v; }
    setLocalLayouts((m) => ({ ...m, [layoutKey]: next }));
    saveLayout(activeId, patch);
  }
  const builtinText = (col: string, r: ViewRow): string => {
    const v = r.values[col];
    if (col === "stage" || col === "status") return fieldById.get(col)?.options?.find((o) => o.id === String(v))?.label ?? "";
    if (col === "staff") return v ? staffNames.get(String(v)) ?? byId.get(r.id)?.assignedStaffName ?? "" : "";
    if (col === "lastActive" || col === "joined") return fmtDay(v);
    if (col === "applications") return typeof v === "number" ? String(v) : "";
    return typeof v === "string" ? v : "";
  };
  const dirty = active ? !sameDef(active.definition, draft) : !sameDef(EMPTY_VIEW, draft);
  const canEditActive = !!active && (active.ownerUserId !== null || !!meta?.canShare);

  function chooseView(id: string) {
    const v = meta?.views.find((x) => x.id === id) ?? null;
    setActiveId(v?.id ?? null);
    setDraft(v ? v.definition : EMPTY_VIEW);
    setPanel(null);
    writeStored(v?.id ?? "");
    try {
      const u = new URL(window.location.href);
      if (v) u.searchParams.set("view", v.id); else u.searchParams.delete("view");
      window.history.replaceState(null, "", u.toString());
    } catch { /* fine */ }
  }

  async function post(body: Record<string, unknown>, ok: string): Promise<SavedViewRecord | true | null> {
    setMsg(null);
    try {
      const res = await fetch("/api/org/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "err", text: data.error || "That did not save. Try again." }); return null; }
      setMsg({ kind: "ok", text: ok });
      await load();
      return data.view ?? true;
    } catch {
      setMsg({ kind: "err", text: "That did not save. Try again." });
      return null;
    }
  }

  const setFilters = (filters: ViewFilter[]) => setDraft({ ...draft, filters });

  const cell = (col: string, c: T): ReactNode => {
    if (!col.startsWith("cf:")) return renderBuiltin(col, c);
    const d = defsById.get(col);
    if (!d) return null;
    const text = formatCustomFieldValue(d, vals.values[c.userId]?.[d.key], staffNames);
    return text ? <span className={d.type === "long_text" ? "line-clamp-2" : undefined}>{text}</span> : <span className="text-t-phos-dim">--</span>;
  };
  const header = (col: string) => {
    const f = fieldById.get(col);
    if (!f) return col;
    return <span>{f.label}{f.sensitive || (col.startsWith("cf:") && defsById.get(col) && isSensitiveField(defsById.get(col)!)) ? <span className="ml-1 font-normal normal-case text-t-amber-bright" title="Sensitive: never sent to AI tools">(sensitive)</span> : null}{f.retired ? <span className="ml-1 font-normal normal-case">(retired)</span> : null}</span>;
  };

  const personal = (meta?.views ?? []).filter((v) => v.ownerUserId !== null);
  const shared = (meta?.views ?? []).filter((v) => v.ownerUserId === null);
  const filterCount = draft.filters.length;
  const canExport = !!meta?.canExport && !readOnly;
  const allShown = shown.length > 0 && shown.every((r) => picked.has(r.id));

  return (
    <div data-testid="caseload-workbench">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Show People as" className="inline-flex border border-t-line">
          {(["list", "grid"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`t-focus min-h-touch px-3 text-xs ${mode === m ? "bg-t-panel-3 font-semibold text-t-white" : "bg-t-panel text-t-phos hover:text-t-white"}`}>
              {m === "list" ? "List" : "Grid"}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="caseload-view">View</label>
        <select id="caseload-view" value={activeId ?? ""} onChange={(e) => chooseView(e.target.value)} className={`${input} min-h-touch max-w-[14rem]`}>
          <option value="">Everyone (default)</option>
          {personal.length > 0 && <optgroup label="My views">{personal.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
          {shared.length > 0 && <optgroup label="Shared with everyone">{shared.map((v) => <option key={v.id} value={v.id}>{v.name}{v.roleDefault ? ` (opens first for ${LAYOUT_ROLE_LABELS[v.roleDefault as keyof typeof LAYOUT_ROLE_LABELS] ?? v.roleDefault})` : ""}</option>)}</optgroup>}
        </select>
        <label className="sr-only" htmlFor="caseload-find">Find by name</label>
        <input id="caseload-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find by name" autoComplete="off" className={`${input} min-h-touch w-36`} />
        <button type="button" aria-expanded={panel === "columns"} onClick={() => setPanel(panel === "columns" ? null : "columns")} className={panel === "columns" ? btnOn : btn}>Columns</button>
        <button type="button" aria-expanded={panel === "filters"} onClick={() => setPanel(panel === "filters" ? null : "filters")} className={panel === "filters" || filterCount ? btnOn : btn}>
          Filter{filterCount ? ` (${filterCount})` : ""}
        </button>
        <button type="button" aria-expanded={panel === "sort"} onClick={() => setPanel(panel === "sort" ? null : "sort")} className={panel === "sort" ? btnOn : btn}>Sort</button>
        <button type="button" aria-expanded={panel === "group"} onClick={() => setPanel(panel === "group" ? null : "group")} className={panel === "group" || draft.groupBy ? btnOn : btn}>Group</button>
        {!readOnly && (
          <button type="button" aria-expanded={panel === "save"} onClick={() => setPanel(panel === "save" ? null : "save")} className={panel === "save" ? btnOn : btn}>
            {dirty ? "Save view *" : "Save view"}
          </button>
        )}
        {canExport && <button type="button" aria-expanded={panel === "export"} onClick={() => setPanel(panel === "export" ? null : "export")} className={panel === "export" ? btnOn : btn}>Export</button>}
        {dirty && (
          <button type="button" onClick={() => setDraft(active ? active.definition : EMPTY_VIEW)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
            Undo changes
          </button>
        )}
      </div>
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mb-2 text-xs ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}

      {panel === "columns" && (canArrange ? (
        <ColumnsPanel fields={fields.filter((f) => f.id !== "name")} columns={columns} onChange={(cols) => setDraft({ ...draft, columns: cols })}
          onReset={() => setDraft({ ...draft, columns: null })} />
      ) : (
        <p role="note" className="mb-3 border border-t-line bg-t-panel px-3 py-3 text-xs text-t-white">
          Your organization keeps the People columns the same for everyone. If it should change, ask whoever manages your organization&apos;s settings.
        </p>
      ))}
      {panel === "filters" && <FiltersPanel fields={fields} filters={draft.filters} onChange={setFilters} staff={vals.staff} />}
      {panel === "sort" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 border border-t-line bg-t-panel px-3 py-3">
          <label className="text-xs text-t-phos-dim" htmlFor="wb-sort">Sort by</label>
          <select id="wb-sort" className={`${input} min-h-touch`} value={draft.sort?.field ?? ""}
            onChange={(e) => setDraft({ ...draft, sort: e.target.value ? { field: e.target.value, dir: draft.sort?.dir ?? "asc" } : null })}>
            <option value="">My usual order ({CASELOAD_SORT_LABELS[meta?.defaultSort ?? "needs_attention"]})</option>
            <optgroup label="Ready-made">{CASELOAD_SORTS.map((k) => <option key={k} value={k}>{CASELOAD_SORT_LABELS[k]}</option>)}</optgroup>
            <optgroup label="By a column">{fields.filter((f) => f.kind !== "multi").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>
          </select>
          {draft.sort && fieldById.has(draft.sort.field) && (
            <select aria-label="Direction" className={`${input} min-h-touch`} value={draft.sort.dir} onChange={(e) => setDraft({ ...draft, sort: { field: draft.sort!.field, dir: e.target.value === "desc" ? "desc" : "asc" } })}>
              <option value="asc">{fieldById.get(draft.sort.field)?.kind === "number" ? "Smallest first" : fieldById.get(draft.sort.field)?.kind === "date" ? "Oldest first" : "A to Z"}</option>
              <option value="desc">{fieldById.get(draft.sort.field)?.kind === "number" ? "Largest first" : fieldById.get(draft.sort.field)?.kind === "date" ? "Newest first" : "Z to A"}</option>
            </select>
          )}
          <span className="text-xs text-t-phos-dim">Empty answers always go last.</span>
        </div>
      )}
      {panel === "group" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 border border-t-line bg-t-panel px-3 py-3">
          <label className="text-xs text-t-phos-dim" htmlFor="wb-group">Group by</label>
          <select id="wb-group" className={`${input} min-h-touch`} value={draft.groupBy ?? ""} onChange={(e) => setDraft({ ...draft, groupBy: e.target.value || null })}>
            <option value="">No groups</option>
            {fields.filter((f) => isGroupableKind(f.kind)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
      )}
      {panel === "save" && !readOnly && (
        <SavePanel active={active} canEditActive={canEditActive} canShare={!!meta?.canShare} draft={draft}
          canSavePersonal={allowed.personal_views} canChooseDefault={allowed.default_view} isDefault={!!active && meta?.defaultView === active.id}
          onMakeDefault={async (on) => {
            const res = await fetch("/api/org/prefs/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "setDefaultView", viewId: on && active ? active.id : null }) });
            const d = await res.json().catch(() => ({}));
            setMsg(res.ok ? { kind: "ok", text: d.summary ? `${d.summary}.` : "Saved." } : { kind: "err", text: d.error || "That did not save. Try again." });
            if (res.ok) await load();
          }}
          onCreate={async (name, isShared, roleDefault) => {
            const v = await post({ action: "create", surface: "caseload", name, definition: { ...draft, grid: layout }, shared: isShared, roleDefault }, `Saved "${name}".`);
            if (v && v !== true) { setActiveId(v.id); writeStored(v.id); setPanel(null); }
          }}
          onUpdate={async () => { if (active) await post({ action: "update", id: active.id, definition: { ...draft, grid: layout } }, `Updated "${active.name}".`); }}
          onRename={async (name) => { if (active) await post({ action: "update", id: active.id, name }, "Renamed."); }}
          onRoleDefault={async (role) => { if (active) await post({ action: "update", id: active.id, roleDefault: role || null }, role ? "It now opens first for that role." : "It no longer opens first for anyone."); }}
          onDelete={async () => {
            if (!active || !window.confirm(`Remove the view "${active.name}"? ${active.ownerUserId === null ? "It goes away for everyone." : "Only you had it."}`)) return;
            if (await post({ action: "delete", id: active.id }, `Removed "${active.name}".`)) { setActiveId(null); setDraft(EMPTY_VIEW); writeStored(""); }
          }}
        />
      )}
      {panel === "export" && canExport && <ExportPanel defs={vals.defs} />}

      {pickable && shown.length > 0 && (
        <label className="mb-2 inline-flex min-h-touch items-center gap-2 text-xs text-t-phos-dim">
          <input type="checkbox" className="t-focus" checked={allShown} onChange={(e) => onPick(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} />
          Select everyone shown ({shown.length})
        </label>
      )}

      {mode === "grid" && !wide && (
        <p role="note" className="mb-2 text-xs text-t-phos-dim">The grid needs a wider screen. Here is the list; the grid is back on a computer or tablet.</p>
      )}
      {showGrid && shown.length > 0 ? (
        <PeopleGrid
          groups={groups}
          columns={columns}
          fields={fields}
          defsByColumn={defsById}
          staff={vals.staff}
          layout={layout}
          density={meta?.density ?? "regular"}
          sort={draft.sort && fieldById.has(draft.sort.field) ? draft.sort : null}
          groupBy={draft.groupBy}
          canEdit={!readOnly && !!meta?.canEditValues}
          editOffReason={readOnly ? "This is a read-only look at the organization." : allowed.grid_edit ? undefined : "Your organization has fields filled in on each person's page, not in the grid."}
          canArrange={canArrange}
          canStyle={allowed.column_width && !readOnly}
          onLayout={changeLayout}
          onColumns={(cols) => setDraft({ ...draft, columns: cols })}
          onSort={(sort) => setDraft({ ...draft, sort })}
          onGroupBy={(groupBy) => setDraft({ ...draft, groupBy })}
          onValues={(values) => setVals((v) => ({ ...v, values: { ...v.values, ...values } }))}
          onOpen={(id) => router.push(`/dashboard/clients/${id}`)}
          builtinText={builtinText}
          labelOf={(col) => fieldById.get(col)?.label ?? col}
        />
      ) : shown.length === 0 ? (
        <div className="border border-t-line bg-t-panel px-5 py-8 text-center text-t-phos-dim">
          {clients.length > 0 ? (
            <>No one matches this view.{(filterCount > 0 || find) && <> <button type="button" className="t-focus underline underline-offset-4" onClick={() => { setFind(""); setFilters([]); }}>Clear the filters</button></>}</>
          ) : empty}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key || "all"} aria-label={g.label || undefined} className="mb-4">
            {g.label && <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-t-amber-bright">{g.label} <span className="font-term text-t-bone-dim">{g.rows.length}</span></h3>}
            <div className="overflow-x-auto border border-t-line bg-t-panel">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-t-line text-left text-xs uppercase text-t-phos-dim">
                    {pickable && <th className="w-8 py-3 pl-4"><span className="sr-only">Select</span></th>}
                    <th className="px-4 py-3 font-semibold">Name</th>
                    {columns.map((col) => <th key={col} className="px-4 py-3 font-semibold">{header(col)}</th>)}
                    {trailing && <th className="px-4 py-3 text-right font-semibold">{trailing.label}</th>}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const c = byId.get(r.id)!;
                    return (
                      <tr key={r.id} className="border-b border-t-line last:border-0">
                        {pickable && (
                          <td className="py-3 pl-4">
                            <input type="checkbox" className="t-focus" aria-label={`Select ${c.name || "this person"}`} checked={picked.has(r.id)}
                              onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); onPick(n); }} />
                          </td>
                        )}
                        <td className="px-4 py-3">{renderBuiltin("name", c)}</td>
                        {columns.map((col) => <td key={col} className="max-w-[220px] px-4 py-3 align-top text-t-phos">{cell(col, c)}</td>)}
                        {trailing && <td className="px-4 py-3 text-right tabular-nums text-t-phos">{trailing.render(c)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ColumnsPanel({ fields, columns, onChange, onReset }: { fields: ViewField[]; columns: string[]; onChange: (c: string[]) => void; onReset: () => void }) {
  const on = new Set(columns);
  const ordered = [...columns.map((c) => fields.find((f) => f.id === c)).filter((f): f is ViewField => !!f), ...fields.filter((f) => !on.has(f.id))];
  const move = (id: string, by: number) => {
    const i = columns.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <fieldset className="mb-3 border border-t-line bg-t-panel px-3 py-3">
      <legend className="px-1 text-xs font-semibold text-t-white">Columns to show, in order</legend>
      <ul className="grid gap-1 sm:grid-cols-2">
        {ordered.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <label className="flex min-h-touch flex-1 items-center gap-2 text-xs text-t-phos">
              <input type="checkbox" className="t-focus" checked={on.has(f.id)} onChange={(e) => onChange(e.target.checked ? [...columns, f.id] : columns.filter((c) => c !== f.id))} />
              {f.label}{f.retired ? " (retired)" : ""}
            </label>
            {on.has(f.id) && (
              <span className="flex gap-1">
                <button type="button" aria-label={`Move ${f.label} left`} onClick={() => move(f.id, -1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white">&uarr;</button>
                <button type="button" aria-label={`Move ${f.label} right`} onClick={() => move(f.id, 1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white">&darr;</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onReset} className="t-focus mt-2 min-h-touch text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Back to the usual columns</button>
    </fieldset>
  );
}

function FiltersPanel({ fields, filters, onChange, staff }: { fields: ViewField[]; filters: ViewFilter[]; onChange: (f: ViewFilter[]) => void; staff: { id: string; name: string }[] }) {
  const set = (i: number, f: ViewFilter) => onChange(filters.map((x, j) => (j === i ? f : x)));
  const first = fields.find((f) => f.id !== "name") ?? fields[0];
  return (
    <div className="mb-3 border border-t-line bg-t-panel px-3 py-3">
      <p className="mb-2 text-xs text-t-phos-dim">Show only people who match every line.</p>
      {filters.length === 0 && <p className="mb-2 text-xs text-t-phos">No filters. Everyone you can see is listed.</p>}
      <ul className="space-y-2">
        {filters.map((f, i) => {
          const field = fields.find((x) => x.id === f.field);
          const ops = field ? FILTER_OPS[field.kind] : [];
          const options = field?.kind === "staff" ? staff.map((s) => ({ id: s.id, label: s.name })) : field?.options ?? [];
          return (
            <li key={i} className="flex flex-wrap items-start gap-2 border-b border-t-line pb-2 last:border-0">
              <select aria-label="Field" className={`${input} min-h-touch`} value={f.field}
                onChange={(e) => { const nf = fields.find((x) => x.id === e.target.value); if (nf) set(i, { field: nf.id, op: FILTER_OPS[nf.kind][0] }); }}>
                {fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <select aria-label="How" className={`${input} min-h-touch`} value={f.op} onChange={(e) => set(i, { field: f.field, op: e.target.value })}>
                {ops.map((o) => <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>)}
              </select>
              <FilterValue filter={f} kind={field?.kind ?? "text"} options={options} onChange={(value) => set(i, { ...f, value })} />
              <button type="button" aria-label="Remove this filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white">Remove</button>
            </li>
          );
        })}
      </ul>
      {first && (
        <button type="button" onClick={() => onChange([...filters, { field: first.id, op: FILTER_OPS[first.kind][0] }])} className="t-focus mt-2 min-h-touch text-xs text-t-amber-bright underline underline-offset-4">
          Add a filter
        </button>
      )}
    </div>
  );
}

function FilterValue({ filter, kind, options, onChange }: { filter: ViewFilter; kind: string; options: { id: string; label: string }[]; onChange: (v: ViewFilter["value"]) => void }) {
  const op = filter.op;
  if (["is_empty", "is_set", "is_true", "is_false"].includes(op)) return null;
  if (["any_of", "none_of", "has_any", "has_all"].includes(op)) {
    const chosen = new Set(Array.isArray(filter.value) ? filter.value : []);
    return (
      <fieldset className="max-h-40 min-w-[10rem] overflow-y-auto border border-t-line px-2 py-1">
        <legend className="sr-only">Choices</legend>
        {options.length === 0 && <span className="text-xs text-t-phos-dim">No choices</span>}
        {options.map((o) => (
          <label key={o.id} className="flex min-h-touch items-center gap-2 text-xs text-t-phos">
            <input type="checkbox" className="t-focus" checked={chosen.has(o.id)}
              onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(o.id); else n.delete(o.id); onChange(Array.from(n)); }} />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (op === "within_days" || op === "older_than_days") {
    return <span className="inline-flex items-center gap-1 text-xs text-t-phos-dim"><input aria-label="Days" type="number" min={0} max={3650} className={`${input} min-h-touch w-20`} value={typeof filter.value === "number" ? filter.value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /> days</span>;
  }
  if (kind === "date") return <input aria-label="Date" type="date" className={`${input} min-h-touch`} value={typeof filter.value === "string" ? filter.value : ""} onChange={(e) => onChange(e.target.value || undefined)} />;
  if (kind === "number") return <input aria-label="Number" type="number" className={`${input} min-h-touch w-28`} value={typeof filter.value === "number" ? filter.value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
  return <input aria-label="Text" type="text" maxLength={200} className={`${input} min-h-touch w-40`} value={typeof filter.value === "string" ? filter.value : ""} onChange={(e) => onChange(e.target.value)} />;
}

function SavePanel({ active, canEditActive, canShare, canSavePersonal = true, canChooseDefault = true, isDefault = false, onMakeDefault, onCreate, onUpdate, onRename, onRoleDefault, onDelete }: {
  active: SavedViewRecord | null; canEditActive: boolean; canShare: boolean; draft: ViewDefinition;
  /** The organization lets this role keep its own views (108). */
  canSavePersonal?: boolean;
  /** The organization lets this role pick which view People opens with (108). */
  canChooseDefault?: boolean;
  isDefault?: boolean;
  onMakeDefault?: (on: boolean) => Promise<void>;
  onCreate: (name: string, shared: boolean, roleDefault: string | null) => Promise<void>;
  onUpdate: () => Promise<void>; onRename: (name: string) => Promise<void>; onRoleDefault: (role: string) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isShared, setShared] = useState(!canSavePersonal && canShare);
  const [role, setRole] = useState("");
  const [rename, setRename] = useState(active?.name ?? "");
  return (
    <div className="mb-3 grid gap-4 border border-t-line bg-t-panel px-3 py-3 sm:grid-cols-2">
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), isShared, isShared && role ? role : null); }} className="space-y-2">
        <h3 className="text-xs font-semibold text-t-white">Save as a new view</h3>
        {!canSavePersonal && !canShare && (
          <p role="note" className="text-xs text-t-white">Your organization does not use personal views. The shared views are in the view menu. If it should change, ask whoever manages your organization&apos;s settings.</p>
        )}
        <label className="block text-xs text-t-phos-dim" htmlFor="wb-name">Name (for example: My quiet people)</label>
        <input id="wb-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={`${input} min-h-touch w-full`} />
        {canShare && (
          <>
            <label className="flex min-h-touch items-center gap-2 text-xs text-t-phos">
              <input type="checkbox" className="t-focus" checked={isShared} disabled={!canSavePersonal} onChange={(e) => setShared(e.target.checked)} />
              Share it with everyone in the organization
            </label>
            {isShared && (
              <label className="block text-xs text-t-phos-dim">Open it first for
                <select value={role} onChange={(e) => setRole(e.target.value)} className={`${input} ml-2 min-h-touch`}>
                  <option value="">Nobody in particular</option>
                  {LAYOUT_ROLES.map((r) => <option key={r} value={r}>{LAYOUT_ROLE_LABELS[r]}</option>)}
                </select>
              </label>
            )}
            {isShared && <p className="text-[11px] text-t-phos-dim">A shared view only arranges the list. Each person still sees only the people they are allowed to see.</p>}
          </>
        )}
        <button disabled={!name.trim() || (!isShared && !canSavePersonal)} className="t-focus min-h-touch bg-[#4f6b57] px-4 text-xs font-semibold text-white disabled:opacity-50">Save view</button>
      </form>
      {active && canEditActive && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-t-white">{active.ownerUserId === null ? "This shared view" : "This view"}: {active.name}</h3>
          <button type="button" onClick={onUpdate} className="t-focus min-h-touch border border-t-line px-3 text-xs text-t-white hover:border-t-line-strong">Save changes to it</button>
          <form onSubmit={(e) => { e.preventDefault(); if (rename.trim()) onRename(rename.trim()); }} className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="wb-rename">New name</label>
            <input id="wb-rename" value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} className={`${input} min-h-touch`} />
            <button className="t-focus min-h-touch px-2 text-xs text-t-phos underline underline-offset-4">Rename</button>
          </form>
          {active.ownerUserId === null && (
            <label className="block text-xs text-t-phos-dim">Opens first for
              <select value={active.roleDefault ?? ""} onChange={(e) => onRoleDefault(e.target.value)} className={`${input} ml-2 min-h-touch`}>
                <option value="">Nobody in particular</option>
                {LAYOUT_ROLES.map((r) => <option key={r} value={r}>{LAYOUT_ROLE_LABELS[r]}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={onDelete} className="t-focus min-h-touch text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-amber-bright">Remove this view</button>
        </div>
      )}
      {active && onMakeDefault && canChooseDefault && (
        <label className="flex min-h-touch items-center gap-2 text-xs text-t-phos sm:col-span-2">
          <input type="checkbox" className="t-focus" checked={isDefault} onChange={(e) => void onMakeDefault(e.target.checked)} />
          Open People with &quot;{active.name}&quot; for me
        </label>
      )}
    </div>
  );
}

/** A POST form (never a link): a download of people's details is a deliberate act from this page. */
function ExportPanel({ defs }: { defs: CustomFieldDef[] }) {
  const sensitive = defs.filter((d) => d.entity === "participant" && isSensitiveField(d));
  const [ticked, setTicked] = useState<string[]>([]);
  return (
    <form method="post" action="/api/org/caseload/export" className="mb-3 border border-t-line bg-t-panel px-3 py-3">
      <p className="text-xs text-t-phos">The spreadsheet has everyone you can see who shares progress, with your organization&apos;s fields. Every download is logged.</p>
      {sensitive.length > 0 && (
        <fieldset className="mt-2">
          <legend className="text-xs font-semibold text-t-white">Sensitive fields stay out unless you tick them</legend>
          {sensitive.map((d) => (
            <label key={d.id} className="flex min-h-touch items-center gap-2 text-xs text-t-phos">
              <input type="checkbox" name="sensitive" value={d.id} className="t-focus" checked={ticked.includes(d.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, d.id] : ticked.filter((x) => x !== d.id))} />
              {d.label}{d.retiredAt ? " (retired)" : ""}
            </label>
          ))}
        </fieldset>
      )}
      <button type="submit" className="t-focus mt-2 inline-flex min-h-touch items-center border border-t-amber px-4 text-xs font-bold text-t-amber-bright hover:bg-t-amber/10">Download CSV</button>
    </form>
  );
}
