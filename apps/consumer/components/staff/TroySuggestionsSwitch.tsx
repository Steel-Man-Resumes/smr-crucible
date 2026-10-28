"use client";
/**
 * <TroySuggestionsSwitch> (integration 2026-10-28; S1 discovery, S3 prefs,
 * S2 My setup): the person's own "t.ROY suggestions" switch. It writes only
 * their own staff prefs (troySuggestions, default on). It draws only when the
 * prefs answer carries troySuggestions, so it is never a dead switch.
 */
import { useEffect, useState } from "react";

const card = "bg-t-panel border border-t-line p-5";

export function TroySuggestionsSwitch() {
  const [state, setState] = useState<{ own: Record<string, unknown>; on: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/org/prefs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && typeof d.effective?.troySuggestions === "boolean") setState({ own: d.own ?? {}, on: d.effective.troySuggestions });
    }).catch(() => {});
  }, []);
  if (!state) return null;
  async function flip(on: boolean) {
    if (!state || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/org/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ own: { ...state.own, troySuggestions: on } }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && typeof d.effective?.troySuggestions === "boolean") { setState({ own: d.own ?? {}, on: d.effective.troySuggestions }); setMsg("Saved."); }
      else setMsg(typeof d.error === "string" && d.error ? d.error : "That did not save. Try again.");
    } catch { setMsg("That did not save. Try again."); }
    setBusy(false);
  }
  return (
    <section id="suggestions" aria-labelledby="suggestions-h" className={`${card} mb-8 scroll-mt-32`}>
      <h2 id="suggestions-h" className="text-lg font-bold text-t-white mb-1">t.ROY suggestions</h2>
      <p className="text-sm text-t-phos-dim mb-3">t.ROY suggests help at pauses, built from the screen you are on. Never while you type.</p>
      <label className="flex items-center gap-2 text-sm text-t-phos">
        <input type="checkbox" className="t-focus" checked={state.on} disabled={busy} onChange={(e) => flip(e.target.checked)} />
        Show me suggestions
      </label>
      <p role="status" aria-live="polite" className="text-xs text-t-amber-bright mt-2">{msg}</p>
    </section>
  );
}
