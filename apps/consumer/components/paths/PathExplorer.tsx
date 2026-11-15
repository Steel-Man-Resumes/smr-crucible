"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useLanes } from "@/components/lanes/useLanes";
import { EMPTY_PATH_INPUTS, pathJobsHref, type PathExploration, type PathInputs } from "@/lib/paths/explore";
import { PATH_INTERESTS, type PathInterest } from "@/lib/paths/occupations";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { choosePathDirection } from "@/lib/paths/choose";
import { useServerText } from "@/components/ServerTextProvider";

const field = "t-focus w-full border border-t-line bg-t-panel px-3 py-2 text-t-white";
const button = "t-focus inline-flex min-h-touch items-center justify-center border border-t-amber px-4 py-2 font-semibold text-t-amber-bright disabled:opacity-50";

export function PathExplorer({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
  const t = useTranslations("refineryJobs.pathExplorer");
  const tc = useTranslations("common.actions");
  const ts = useServerText();
  const Title = headingLevel === 1 ? "h1" : "h2";
  const lanes = useLanes();
  const [result, setResult] = useState<PathExploration | null>(null);
  const [inputs, setInputs] = useState<PathInputs>(EMPTY_PATH_INPUTS);
  const [additional, setAdditional] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const ownSwitch = useRef<string | null>(null);
  const latestInputs = useRef(inputs);
  latestInputs.current = { ...inputs, additionalSkills: additional.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) };
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [choiceError, setChoiceError] = useState("");
  const [selected, setSelected] = useState<{ id: string; laneId: string; title: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const version = useRef(0);
  const currentLane = useRef(lanes.active);
  currentLane.current = lanes.active;

  useEffect(() => {
    if (!lanes.loaded || lanes.error || !lanes.userId) return;
    const controller = new AbortController();
    const requestVersion = ++version.current;
    const keepComparison = ownSwitch.current === lanes.active;
    ownSwitch.current = null;
    if (!keepComparison) { setResult(null); setSelected(null); setInputs(EMPTY_PATH_INPUTS); setAdditional(""); }
    setError(""); setPending(null); setBusy(true);
    const url = keepComparison ? "/api/paths" : `/api/paths?laneId=${encodeURIComponent(lanes.active)}`;
    const options = keepComparison ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ laneId: lanes.active, inputs: latestInputs.current }) } : {};
    fetch(url, { ...options, cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("loadFailed"));
      if (requestVersion !== version.current) return;
      setResult(data); setInputs({ ...data.inputs, location: data.location });
    }).catch((err) => { if (err.name !== "AbortError" && requestVersion === version.current) setError(err.message); })
      .finally(() => { if (requestVersion === version.current) setBusy(false); });
    return () => { controller.abort(); version.current++; };
  }, [lanes.loaded, lanes.active, lanes.userId, lanes.error, reloadKey]);

  async function compare(event: React.FormEvent) {
    event.preventDefault();
    const requestVersion = ++version.current;
    setBusy(true); setError(""); setPending(null);
    const next = { ...inputs, additionalSkills: additional.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) };
    try {
      const response = await fetch("/api/paths", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ laneId: lanes.active, inputs: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("compareFailed"));
      if (requestVersion === version.current) { setResult(data); setInputs(data.inputs); setSelected(null); }
    } catch (err) { if (requestVersion === version.current) setError(err instanceof Error ? err.message : t("tryAgain")); }
    finally { if (requestVersion === version.current) setBusy(false); }
  }

  async function choose(candidate: PathExploration["candidates"][number]) {
    const laneAtStart = lanes.active;
    setChoosing(candidate.id); setChoiceError("");
    try {
      const chosen = await choosePathDirection(candidate.searchRole, laneAtStart, () => currentLane.current);
      setSelected({ id: candidate.id, laneId: chosen.laneId, title: candidate.title }); setPending(null);
      // Reconcile the saved lane without discarding this comparison input.
      ownSwitch.current = chosen.laneId !== lanes.active ? chosen.laneId : null;
      window.dispatchEvent(new CustomEvent(LANES_CHANGED_EVENT, { detail: { kind: "list" } }));
    } catch (err) { setChoiceError(err instanceof Error ? err.message : t("choiceFailed")); }
    finally { setChoosing(null); }
  }

  const context = result?.context;
  return (
    <div className="max-w-5xl space-y-6">
      <header className="max-w-3xl space-y-2">
        <p className="text-sm text-t-amber-bright">{t("breadcrumb")}</p>
        <Title className="text-3xl font-bold text-t-white">{t("title")}</Title>
        <p className="text-t-phos-dim">{t("subtitle")}</p>
      </header>
      {lanes.error && <div role="alert" className="border border-t-line p-4 text-t-phos">{lanes.error} <button className={button} onClick={() => void lanes.refresh()}>{t("retry")}</button></div>}
      {context && <section className="border border-t-line bg-t-panel p-4 space-y-2" aria-label={t("startingFrom")}>
        <h2 className="font-semibold text-t-white">{t("startingFrom")}</h2>
        <p className="text-sm text-t-phos-dim">{context.target ? `${t("currentGoal",{goal:context.target})} ` : `${t("noGoal")} `}{t("skillsEvidence")}</p>
        {context.savedSkills.length > 0 ? <div className="flex flex-wrap gap-2">{context.savedSkills.map((skill) => <span key={skill} className="border border-t-line px-2 py-1 text-sm text-t-phos">{skill}</span>)}</div> : <p className="text-sm text-t-phos-dim">{t("noSkills")}</p>}
        {context.savedConstraints.length > 0 && <p className="text-sm text-t-phos">{t("keepingInMind",{list:context.savedConstraints.map(ts).join("; ")})}</p>}
      </section>}
      <form onSubmit={compare} className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold text-t-white">{t("formTitle")}</h2>
        <p className="text-sm text-t-phos-dim">{t("formIntro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-t-phos">{t("urgencyLabel")}<select className={`${field} mt-1`} value={inputs.urgency} onChange={(e) => setInputs({ ...inputs, urgency: e.target.value as PathInputs["urgency"] })}><option value="unknown">{t("leaveOpen")}</option><option value="now">{t("urgencyNow")}</option><option value="explore">{t("urgencyExplore")}</option></select></label>
          <label className="text-sm text-t-phos">{t("trainingLabel")}<select className={`${field} mt-1`} value={inputs.training} onChange={(e) => setInputs({ ...inputs, training: e.target.value as PathInputs["training"] })}><option value="unknown">{t("leaveOpen")}</option><option value="on_job">{t("trainingOnJob")}</option><option value="short">{t("trainingShort")}</option><option value="extended">{t("trainingExtended")}</option></select></label>
          <label className="text-sm text-t-phos">{t("locationLabel")}<input className={`${field} mt-1`} maxLength={160} value={inputs.location} onChange={(e) => setInputs({ ...inputs, location: e.target.value })} placeholder={t("locationPlaceholder")} /></label>
          <label className="text-sm text-t-phos">{t("scheduleLabel")}<input className={`${field} mt-1`} maxLength={160} value={inputs.schedule} onChange={(e) => setInputs({ ...inputs, schedule: e.target.value })} placeholder={t("schedulePlaceholder")} /></label>
          <label className="text-sm text-t-phos">{t("transportLabel")}<input className={`${field} mt-1`} maxLength={160} value={inputs.transport} onChange={(e) => setInputs({ ...inputs, transport: e.target.value })} placeholder={t("transportPlaceholder")} /></label>
          <label className="text-sm text-t-phos">{t("skillsLabel")}<input className={`${field} mt-1`} maxLength={1600} value={additional} onChange={(e) => setAdditional(e.target.value)} placeholder={t("skillsPlaceholder")} /></label>
        </div>
        <fieldset><legend className="mb-2 text-sm font-semibold text-t-phos">{t("interestsLegend")}</legend><div className="grid gap-2 sm:grid-cols-3">{Object.keys(PATH_INTERESTS).map((key) => <label key={key} className="flex items-center gap-2 text-sm text-t-phos"><input type="checkbox" className="t-focus" checked={inputs.interests.includes(key as PathInterest)} onChange={(e) => setInputs({ ...inputs, interests: e.target.checked ? [...inputs.interests, key as PathInterest] : inputs.interests.filter((i) => i !== key) })} />{t(`interests.${key}`)}</label>)}</div></fieldset>
        <details className="text-sm text-t-phos"><summary className="t-focus cursor-pointer">{t("avoidSummary")}</summary><div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.keys(PATH_INTERESTS).map((key) => <label key={key} className="flex items-center gap-2"><input type="checkbox" className="t-focus" checked={inputs.avoid.includes(key as PathInterest)} onChange={(e) => setInputs({ ...inputs, avoid: e.target.checked ? [...inputs.avoid, key as PathInterest] : inputs.avoid.filter((i) => i !== key) })} />{t(`interests.${key}`)}</label>)}</div></details>
        <button className={`${button} bg-t-amber text-white`} disabled={busy || !context || !!lanes.error}>{busy ? t("comparing") : t("compare")}</button>
        {error && <p role="alert" className="text-t-phos">{ts(error)} <button type="button" className={button} onClick={() => setReloadKey((key) => key + 1)}>{t("reloadContext")}</button></p>}
      </form>
      <section aria-busy={busy} aria-label={t("directionsAria")} className="space-y-4">
        <div className="space-y-1"><h2 className="text-xl font-bold text-t-white">{t("directionsTitle")}</h2><p className="text-sm text-t-phos-dim">{t("directionsIntro",{count:result?.occupationCount ?? 12})}</p></div>
        {result?.missing.length ? <p className="text-sm text-t-phos">{t("missingHelp",{list:result.missing.map(ts).join("; ")})}</p> : null}
        {choiceError && <p role="alert" className="border border-t-line p-3 text-t-phos">{ts(choiceError)}</p>}
        {result && !result.candidates.length && <p role="status" className="border border-t-line p-5 text-t-phos">{t("noneLeft")}</p>}
        <div className="grid gap-4 lg:grid-cols-2">{result?.candidates.map((candidate) => <article key={candidate.id} className="border border-t-line bg-t-panel p-5 space-y-4">
          <div><p className="text-xs text-t-amber-bright">{ts(candidate.next)}</p><h3 className="mt-1 text-xl font-bold text-t-white">{ts(candidate.title)}</h3></div>
          <div className="text-sm text-t-phos space-y-2"><p>{ts(candidate.explanation)}</p>{candidate.matches.length > 0 && <p><strong>{t("startingEvidence")}</strong> {candidate.matches.map((match) => `${match.label} (${match.origin === "saved_profile" ? t("savedProfile") : t("youAdded")})`).join("; ")}.</p>}{candidate.interests.length > 0 && <p><strong>{t("yourInterests")}</strong> {candidate.interests.map((interest) => t(`interests.${interest}`)).join(", ")}.</p>}{candidate.targetMatch && <p>{t("relatedGoal")}</p>}</div>
          <div className="space-y-2 text-sm text-t-phos"><p><strong>{t("theWork")}</strong> {ts(candidate.tasks)}</p><p><strong>{t("entryRoute")}</strong> {ts(candidate.entry)}</p></div>
          <details className="text-sm text-t-phos"><summary className="t-focus cursor-pointer font-semibold">{t("needsChecking")}</summary><ul className="mt-2 list-disc pl-5 space-y-1">{candidate.unknowns.map((unknown) => <li key={unknown}>{ts(unknown)}</li>)}</ul></details>
          <p className="text-xs text-t-phos-dim"><a className="t-focus underline" href={candidate.source.url} target="_blank" rel="noreferrer">{ts(candidate.source.title)}</a>. {t("sourceNote",{date:candidate.source.reviewedAt})}</p>
          <div className="flex flex-wrap gap-2"><Link className={button} href={pathJobsHref(candidate.searchRole, result.location, selected?.id === candidate.id ? selected.laneId : undefined)}>{result.location ? t("findJobsIn",{location:result.location}) : t("findJobs")}</Link><button type="button" className={button} disabled={!!choosing || busy} onClick={() => { setPending(candidate.id); setChoiceError(""); }}>{t("chooseDirection")}</button></div>
          {pending === candidate.id && <div className="border border-t-amber p-3 space-y-2 text-sm text-t-phos"><p>{t("confirmPrompt",{role:candidate.searchRole})}</p><div className="flex gap-2"><button type="button" className={button} disabled={!!choosing} onClick={() => void choose(candidate)}>{choosing === candidate.id ? t("savingChoice") : t("confirmDirection")}</button><button type="button" className={button} disabled={!!choosing} onClick={() => setPending(null)}>{tc("cancel")}</button></div></div>}
          {selected?.id === candidate.id && <p role="status" className="text-sm text-t-phos">{t("goalSaved",{title:ts(selected.title)})}</p>}
        </article>)}</div>
        {context?.target && <Link className={button} href={pathJobsHref(context.target, inputs.location || context.location, context.laneId)}>{t("searchExisting",{goal:context.target})}</Link>}
      </section>
      <aside className="border-t border-t-line pt-4 text-sm text-t-phos-dim"><p>{t("asideNote")}</p><Link className="t-focus mt-2 inline-block text-t-amber-bright underline" href="/dashboard/resources">{t("findSupport")}</Link></aside>
    </div>
  );
}
