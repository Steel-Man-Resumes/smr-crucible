"use client";

/**
 * <MyViewSettings> -- every way a staff member shapes their OWN screens, in
 * one place (staff build S3). Built for "My setup" (lane S2 mounts it on
 * /dashboard/my-setup): People opens as a list or a grid, with which view, at
 * which row height; a person's page tabs in their own order; and "Recent
 * changes to my view", where anything changed by hand or by t.ROY can be
 * undone with one click.
 *
 * Every control goes through the view action layer (/api/org/prefs/view),
 * so the organization's limits (migration 108) hold, and a locked control is
 * drawn locked with the reason. Nothing here changes anyone else's screen.
 */
import { useCallback, useEffect, useState } from "react";
import { PERSON_TAB_KEYS, type StaffPrefs } from "@crucible/core/src/staffPrefsShared";
import { ROW_DENSITIES, ROW_DENSITY_LABELS } from "@crucible/core/src/viewLayoutShared";
import { PERSON_TAB_LABELS } from "@crucible/core/src/viewActionsShared";
import { POLICY_LOCKED_TEXT, type PolicyAllowed } from "@crucible/core/src/customizationPolicyShared";
import { VIEW_CHANGED_EVENT, announceViewChanged } from "@/lib/view-change-events";

interface PrefsPayload { effective: StaffPrefs; allowed: PolicyAllowed }
interface ViewOption { id: string; name: string; ownerUserId: string | null }
export interface ViewChangeEntry { id: string; surface: string; action: string; summary: string; byAi: boolean; at: string; undoneAt: string | null }

const select = "t-focus min-h-touch border border-t-line bg-t-panel px-2 text-sm text-t-white disabled:opacity-60";

async function act(body: Record<string, unknown>): Promise<{ ok: boolean; text: string; changeId?: string | null }> {
  try {
    const res = await fetch("/api/org/prefs/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) announceViewChanged({ target: d.target, summary: d.summary });
    return { ok: res.ok || d.reason === "unchanged", text: res.ok ? `${d.summary}.` : d.reason === "unchanged" ? "" : d.error || "That did not save. Try again.", changeId: d.changeId ?? null };
  } catch {
    return { ok: false, text: "That did not save. Try again." };
  }
}

export function MyViewSettings() {
  const [prefs, setPrefs] = useState<PrefsPayload | null>(null);
  const [views, setViews] = useState<ViewOption[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const [p, v] = await Promise.all([
        fetch("/api/org/prefs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/org/views?surface=caseload", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!p) { setFailed(true); return; }
      setPrefs(p);
      setViews((v?.views ?? []) as ViewOption[]);
      setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener(VIEW_CHANGED_EVENT, again);
    return () => window.removeEventListener(VIEW_CHANGED_EVENT, again);
  }, [load]);

  if (failed) return <p role="alert" className="text-sm text-t-white">Your screen settings did not load. <button type="button" onClick={load} className="t-focus underline underline-offset-4">Try again</button></p>;
  if (!prefs) return <p role="status" className="text-sm text-t-phos-dim">Getting your screen settings.</p>;
  const e = prefs.effective;
  const a = prefs.allowed;
  const run = async (body: Record<string, unknown>) => { const r = await act(body); if (r.text) setMsg({ kind: r.ok ? "ok" : "err", text: r.text }); await load(); };
  const tabs = [...(e.personTabs ?? []), ...PERSON_TAB_KEYS.filter((k) => !(e.personTabs ?? []).includes(k))];
  const moveTab = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= tabs.length) return;
    const n = [...tabs];
    [n[i], n[j]] = [n[j], n[i]];
    void run({ action: "setPersonTabsOrder", tabs: n });
  };
  const locked = (k: keyof PolicyAllowed) => (a[k] === false ? <p className="text-xs text-t-phos-dim">{POLICY_LOCKED_TEXT[k]}</p> : null);

  return (
    <div className="space-y-6" data-testid="my-view-settings">
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`text-sm ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}

      <section className="border border-t-line bg-t-panel px-4 py-4">
        <h3 className="text-sm font-semibold text-t-white">People</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="block text-xs text-t-phos-dim">Show people as
            <select className={`${select} mt-1 block w-full`} value={e.peopleMode} onChange={(ev) => run({ action: "setPeopleMode", mode: ev.target.value })}>
              <option value="list">A list</option>
              <option value="grid">A grid (spreadsheet)</option>
            </select>
          </label>
          <label className="block text-xs text-t-phos-dim">Open People with
            <select className={`${select} mt-1 block w-full`} disabled={a.default_view === false} value={e.defaultView ?? ""}
              onChange={(ev) => run({ action: "setDefaultView", viewId: ev.target.value === "" ? null : ev.target.value })}>
              <option value="">The usual (last one I used)</option>
              <option value="none">Everyone, no view</option>
              {views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.ownerUserId === null ? " (shared)" : ""}</option>)}
            </select>
            {locked("default_view")}
          </label>
          <label className="block text-xs text-t-phos-dim">Row height in the grid
            <select className={`${select} mt-1 block w-full`} disabled={a.density === false} value={e.density} onChange={(ev) => run({ action: "setDensity", density: ev.target.value })}>
              {ROW_DENSITIES.map((d) => <option key={d} value={d}>{ROW_DENSITY_LABELS[d]}</option>)}
            </select>
            {locked("density")}
          </label>
        </div>
        <p className="mt-3 text-xs text-t-phos-dim">Columns, filters and your own views are on People, under Columns and Save view. In the grid, drag a column edge to resize it.</p>
      </section>

      <section className="border border-t-line bg-t-panel px-4 py-4">
        <h3 className="text-sm font-semibold text-t-white">A person&apos;s page: tab order</h3>
        {locked("person_tabs_order")}
        <ol className="mt-2 space-y-1">
          {tabs.map((k, i) => (
            <li key={k} className="flex items-center gap-2 text-sm text-t-phos">
              <span className="w-5 text-right text-xs text-t-phos-dim">{i + 1}</span>
              <span className="flex-1">{PERSON_TAB_LABELS[k]}</span>
              {a.person_tabs_order !== false && (
                <span className="flex">
                  <button type="button" aria-label={`Move ${PERSON_TAB_LABELS[k]} up`} disabled={i === 0} onClick={() => moveTab(i, -1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&uarr;</button>
                  <button type="button" aria-label={`Move ${PERSON_TAB_LABELS[k]} down`} disabled={i === tabs.length - 1} onClick={() => moveTab(i, 1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&darr;</button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {(e.personTabs ?? []).length > 0 && a.person_tabs_order !== false && (
          <button type="button" onClick={() => run({ action: "setPersonTabsOrder", tabs: [] })} className="t-focus mt-2 min-h-touch text-xs text-t-phos-dim underline underline-offset-4">Back to the usual order</button>
        )}
      </section>

      <section className="border border-t-line bg-t-panel px-4 py-4">
        <h3 className="text-sm font-semibold text-t-white">Today</h3>
        <p className="mt-1 text-xs text-t-phos-dim">Put Today&apos;s sections in your own order with &quot;Arrange my Today&quot; on Today, and fold any section from its heading.</p>
        {locked("today_order")}
      </section>

      <RecentViewChanges />
    </div>
  );
}

/**
 * "Recent changes to my view": the person's own view change log (108), newest
 * first, made by hand or by t.ROY, each with Undo.
 */
export function RecentViewChanges({ initial }: { initial?: ViewChangeEntry[] }) {
  const [list, setList] = useState<ViewChangeEntry[] | null>(initial ?? null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const d = await fetch("/api/org/prefs/changes?limit=30", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setList(d.changes ?? []);
  }, []);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener(VIEW_CHANGED_EVENT, again);
    return () => window.removeEventListener(VIEW_CHANGED_EVENT, again);
  }, [load]);

  async function undo(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/org/prefs/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", id }) });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? { kind: "ok", text: `${d.summary}.` } : { kind: "err", text: d.error || "That did not undo. Try again." });
      if (res.ok) announceViewChanged({ target: d.target, summary: d.summary });
      await load();
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="recent-view-h" className="border border-t-line bg-t-panel px-4 py-4" data-testid="recent-view-changes">
      <h3 id="recent-view-h" className="text-sm font-semibold text-t-white">Recent changes to my view</h3>
      <p className="mt-1 text-xs text-t-phos-dim">Changes to your own screens, made by you or by t.ROY. Undo puts that one thing back. Nobody else sees this list.</p>
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-2 text-sm ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}
      {list === null ? <p role="status" className="mt-2 text-sm text-t-phos-dim">Getting your changes.</p>
        : list.length === 0 ? <p className="mt-2 text-sm text-t-phos">Nothing yet. When you or t.ROY change how your screens look, it shows here.</p>
        : (
          <ul className="mt-3 divide-y divide-t-line">
            {list.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className={`min-w-0 flex-1 ${c.undoneAt ? "text-t-phos-dim line-through" : "text-t-white"}`}>{c.summary}</span>
                {c.byAi && <span className="border border-purple-400 px-1.5 text-[11px] text-purple-300">t.ROY</span>}
                <time dateTime={c.at} className="text-xs text-t-phos-dim">{new Date(c.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                {c.action === "undo" ? <span className="text-xs text-t-phos-dim">an undo</span>
                  : c.undoneAt ? <span className="text-xs text-t-phos-dim">undone</span>
                  : <button type="button" disabled={busy === c.id} onClick={() => undo(c.id)} className="t-focus min-h-touch px-2 text-xs font-semibold text-t-amber-bright underline underline-offset-4 disabled:opacity-50">Undo</button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
