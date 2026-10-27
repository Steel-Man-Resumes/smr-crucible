"use client";

/**
 * <LayoutSettingsPage> -- /dashboard/layouts (house build L4).
 *
 * Per role, what Today shows and in what order, and which People columns show
 * when nobody picked a view. Each person can still fold or hide Today
 * sections for themselves, and pick their own columns and views. Managers
 * change it (org.settings.manage); everyone else sees it read-only.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Option { key: string; label: string }
interface Payload {
  layouts: { today: Record<string, { order: string[]; hidden: string[] }>; caseload: Record<string, { columns: string[] }> };
  roles: Option[]; sections: Option[]; columns: Option[]; canManage: boolean; myRole: string;
}

export function LayoutSettingsPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState("staff");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/layouts", { cache: "no-store" });
      if (!res.ok) { setFailed(true); return; }
      setD(await res.json()); setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function put(surface: "today" | "caseload", layout: unknown, ok: string) {
    setMsg(null);
    try {
      const res = await fetch("/api/org/layouts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, surface, layout }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "err", text: body.error || "That did not save. Try again." }); return; }
      setD((cur) => (cur ? { ...cur, layouts: body.layouts } : cur));
      setMsg({ kind: "ok", text: ok });
    } catch { setMsg({ kind: "err", text: "That did not save. Try again." }); }
  }

  if (failed) return (
    <div className="mx-auto max-w-3xl" role="alert">
      <h1 className="font-display text-3xl font-bold text-t-white">Layouts</h1>
      <p className="mt-3 text-sm text-t-white">This page did not load. Nothing was lost.</p>
      <button type="button" onClick={load} className="t-focus mt-2 min-h-touch text-sm font-semibold text-t-amber-bright underline underline-offset-4">Try again</button>
    </div>
  );
  if (!d) return <div className="mx-auto max-w-3xl"><h1 className="font-display text-3xl font-bold text-t-white">Layouts</h1><p role="status" className="mt-3 text-sm text-t-phos-dim">Getting your layouts.</p></div>;

  const today = d.layouts.today[role] ?? null;
  const order = today ? [...today.order, ...d.sections.map((s) => s.key).filter((k) => !today.order.includes(k))] : d.sections.map((s) => s.key);
  const hidden = new Set(today?.hidden ?? []);
  const caseload = d.layouts.caseload[role] ?? null;
  const roleLabel = d.roles.find((r) => r.key === role)?.label ?? role;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-bold text-t-white">Layouts</h1>
      <p className="mt-1 text-sm text-t-phos">Choose what each role sees first. Each person can still fold sections and pick their own views.</p>
      {!d.canManage && <p role="note" className="mt-3 border-l-[3px] border-t-amber bg-t-panel px-3 py-2 text-xs text-t-white">Only someone who manages your organization&apos;s settings can change layouts.</p>}

      <div role="tablist" aria-label="Role" className="mt-5 flex flex-wrap gap-1 border-b border-t-line">
        {d.roles.map((r) => (
          <button key={r.key} role="tab" aria-selected={role === r.key} onClick={() => { setRole(r.key); setMsg(null); }}
            className={`t-focus -mb-px min-h-touch border-b-2 px-4 text-sm ${role === r.key ? "border-t-amber font-semibold text-t-white" : "border-transparent text-t-phos-dim hover:text-t-white"}`}>
            {r.label}{r.key === d.myRole ? " (you)" : ""}
          </button>
        ))}
      </div>
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-3 text-sm ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}

      <OrderedChecklist
        title={`Today for ${roleLabel}`}
        note={today ? "Set by your organization." : d.canManage ? "The built-in order. Change it and save." : "The built-in order."}
        items={order.map((k) => ({ key: k, label: d.sections.find((s) => s.key === k)?.label ?? k, on: !hidden.has(k) }))}
        disabled={!d.canManage}
        onSave={(items) => put("today", { order: items.map((i) => i.key), hidden: items.filter((i) => !i.on).map((i) => i.key) }, `Saved Today for ${roleLabel}.`)}
        onReset={today ? () => put("today", null, `Today for ${roleLabel} is back to the built-in order.`) : undefined}
        hint="A hidden section is not shown to this role at all. To hide one only for yourself, use Settings, My workflow."
      />

      <OrderedChecklist
        title={`People columns for ${roleLabel}`}
        note={caseload ? "Set by your organization." : d.canManage ? "Every built-in column. Change it and save." : "Every built-in column."}
        items={[
          ...(caseload?.columns ?? []).map((k) => ({ key: k, label: d.columns.find((c) => c.key === k)?.label ?? k, on: true })),
          ...d.columns.filter((c) => !(caseload?.columns ?? []).includes(c.key)).map((c) => ({ key: c.key, label: c.label, on: !caseload && !c.key.startsWith("cf:") })),
        ].filter((i) => d.columns.some((c) => c.key === i.key))}
        disabled={!d.canManage}
        onSave={(items) => put("caseload", { columns: items.filter((i) => i.on).map((i) => i.key) }, `Saved the People columns for ${roleLabel}.`)}
        onReset={caseload ? () => put("caseload", null, `People columns for ${roleLabel} are back to the built-in set.`) : undefined}
        hint="These show when someone has not picked a view. Shared views are saved from People, under Save view."
      />

      <p className="mt-8 text-xs text-t-phos-dim">Your organization&apos;s own fields are on the <Link href="/dashboard/fields" className="t-focus underline underline-offset-4">Fields</Link> page.</p>
    </div>
  );
}

function OrderedChecklist({ title, note, items: initial, disabled, onSave, onReset, hint }: {
  title: string; note: string; items: { key: string; label: string; on: boolean }[]; disabled: boolean;
  onSave: (items: { key: string; label: string; on: boolean }[]) => void; onReset?: () => void; hint: string;
}) {
  const [items, setItems] = useState(initial);
  const sig = JSON.stringify(initial);
  useEffect(() => { setItems(JSON.parse(sig)); }, [sig]);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    setItems(n);
  };
  return (
    <section className="mt-6 border border-t-line bg-t-panel px-4 py-4">
      <h2 className="text-sm font-semibold text-t-white">{title}</h2>
      <p className="text-xs text-t-phos-dim">{note}</p>
      <ul className="mt-3 space-y-1">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-2">
            <label className="flex min-h-touch flex-1 items-center gap-2 text-sm text-t-phos">
              <input type="checkbox" className="t-focus" disabled={disabled} checked={it.on} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              {it.label}
            </label>
            {!disabled && (
              <span className="flex">
                <button type="button" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&uarr;</button>
                <button type="button" aria-label={`Move ${it.label} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&darr;</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-t-phos-dim">{hint}</p>
      {!disabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onSave(items)} className="t-focus min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white hover:bg-[#3d5745]">Save</button>
          {onReset && <button type="button" onClick={onReset} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim underline underline-offset-4">Back to the built-in default</button>}
        </div>
      )}
    </section>
  );
}
