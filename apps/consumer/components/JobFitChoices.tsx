"use client";
import { useEffect, useState } from "react";
import { readJobFit, type JobFitPreferences } from "@/lib/job-fit";

export function JobFitChoices({ onChange }: { onChange: (value: JobFitPreferences) => void }) {
  const [value, setValue] = useState(readJobFit(null));
  const [titles, setTitles] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    fetch("/api/user/job-fit", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (!live) return;
      const next = readJobFit(body.preferences);
      setValue(next); setTitles(next.excludedTitles.join(", ")); onChange(next);
    }).catch(() => { if (live) setError("We couldn't load your choices. Retry before reviewing job results."); });
    return () => { live = false; };
  }, [retry, onChange]);
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const next = readJobFit({ ...value, excludedTitles: titles.split(",") });
      const r = await fetch("/api/user/job-fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!r.ok) throw new Error();
      onChange(next); setValue(next); setSaved(true);
    } catch { setError("Your choices weren't saved. Try again. Your previous choices still apply."); }
    finally { setBusy(false); }
  }
  return <details open={error ? true : undefined} className="mb-6 border border-t-line bg-t-panel p-5">
    <summary className="t-focus cursor-pointer font-semibold">Work that fits your life</summary>
    <p className="mt-3 text-sm text-t-phos">Tell us what to leave out. These filters use what the listing explicitly says. Missing details still need checking with the employer.</p>
    <label className="mt-4 block text-sm">Job titles I do not want
      <input value={titles} maxLength={720} onChange={(e) => { setTitles(e.target.value); setSaved(false); }} placeholder="Separate titles with commas" className="mt-2 min-h-touch w-full border border-t-line bg-t-bg p-3" />
    </label>
    {([['noDriving', 'Leave out jobs that require driving'], ['noHeavyLifting', 'Leave out jobs that require heavy lifting (50 pounds or more)'], ['noOvernight', 'Leave out jobs that require overnight work']] as const).map(([key, label]) => <label key={key} className="mt-3 flex min-h-touch items-center gap-3 text-sm"><input type="checkbox" checked={value[key]} onChange={(e) => { setValue((v) => ({ ...v, [key]: e.target.checked })); setSaved(false); }} />{label}</label>)}
    <p className="mt-3 text-xs text-t-phos-dim">A record does not automatically rule you out. Use the Disclosure Planner with t.ROY to discuss a particular job. Confirm legal or licensing restrictions with a qualified source.</p>
    <button type="button" disabled={busy} onClick={() => void save()} className="t-focus mt-4 min-h-touch bg-t-amber px-5 text-ws-bg">{busy ? "Saving..." : "Save my choices"}</button>
    {saved && <p role="status" className="mt-2 text-sm">Saved. These choices apply to your job results.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-t-red">{error} <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus underline">Reload choices</button></p>}
  </details>;
}
