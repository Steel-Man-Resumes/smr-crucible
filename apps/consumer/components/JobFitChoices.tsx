"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readJobFit, type JobFitPreferences } from "@/lib/job-fit";

export function JobFitChoices({ onChange }: { onChange: (value: JobFitPreferences) => void }) {
  const t = useTranslations("refineryJobs.jobFit");
  const [value, setValue] = useState(readJobFit(null));
  const [titles, setTitles] = useState("");
  const [error, setError] = useState<"" | "load" | "save">("");
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
    }).catch(() => { if (live) setError("load"); });
    return () => { live = false; };
  }, [retry, onChange]);
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const next = readJobFit({ ...value, excludedTitles: titles.split(",") });
      const r = await fetch("/api/user/job-fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!r.ok) throw new Error();
      onChange(next); setValue(next); setSaved(true);
    } catch { setError("save"); }
    finally { setBusy(false); }
  }
  return <details open={error ? true : undefined} className="mb-6 border border-t-line bg-t-panel p-5">
    <summary className="t-focus cursor-pointer font-semibold">{t("summary")}</summary>
    <p className="mt-3 text-sm text-t-phos">{t("intro")}</p>
    <label className="mt-4 block text-sm">{t("titlesLabel")}
      <input value={titles} maxLength={720} onChange={(e) => { setTitles(e.target.value); setSaved(false); }} placeholder={t("titlesPlaceholder")} className="mt-2 min-h-touch w-full border border-t-line bg-t-bg p-3" />
    </label>
    {(['noDriving', 'noHeavyLifting', 'noOvernight'] as const).map((key) => <label key={key} className="mt-3 flex min-h-touch items-center gap-3 text-sm"><input type="checkbox" checked={value[key]} onChange={(e) => { setValue((v) => ({ ...v, [key]: e.target.checked })); setSaved(false); }} />{t(`options.${key}`)}</label>)}
    <p className="mt-3 text-xs text-t-phos-dim">{t("recordNote")}</p>
    <button type="button" disabled={busy} onClick={() => void save()} className="t-focus mt-4 min-h-touch bg-t-amber px-5 text-ws-bg">{busy ? t("saving") : t("save")}</button>
    {saved && <p role="status" className="mt-2 text-sm">{t("saved")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-t-red">{t(`errors.${error}`)} <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus underline">{t("reload")}</button></p>}
  </details>;
}
