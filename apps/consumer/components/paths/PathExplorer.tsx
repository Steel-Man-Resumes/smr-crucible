"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLanes } from "@/components/lanes/useLanes";
import { EMPTY_PATH_INPUTS, pathJobsHref, type PathExploration, type PathInputs } from "@/lib/paths/explore";
import { PATH_INTERESTS, type PathInterest } from "@/lib/paths/occupations";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { choosePathDirection } from "@/lib/paths/choose";

const field = "t-focus w-full border border-t-line bg-t-panel px-3 py-2 text-t-white";
const button = "t-focus inline-flex min-h-touch items-center justify-center border border-t-amber px-4 py-2 font-semibold text-t-amber-bright disabled:opacity-50";

export function PathExplorer({ headingLevel = 1 }: { headingLevel?: 1 | 2 } = {}) {
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
      if (!response.ok) throw new Error(data.error || "Your paths could not be loaded.");
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
      if (!response.ok) throw new Error(data.error || "Your paths could not be compared.");
      if (requestVersion === version.current) { setResult(data); setInputs(data.inputs); setSelected(null); }
    } catch (err) { if (requestVersion === version.current) setError(err instanceof Error ? err.message : "Try again."); }
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
    } catch (err) { setChoiceError(err instanceof Error ? err.message : "This choice could not be saved."); }
    finally { setChoosing(null); }
  }

  const context = result?.context;
  return (
    <div className="max-w-5xl space-y-6">
      <header className="max-w-3xl space-y-2">
        <p className="text-sm text-t-amber-bright">Find work / Explore paths</p>
        <Title className="text-3xl font-bold text-t-white">Find your next direction</Title>
        <p className="text-t-phos-dim">Compare work you could build toward with what you already bring and what matters today. Choosing a direction is up to you.</p>
      </header>
      {lanes.error && <div role="alert" className="border border-t-line p-4 text-t-phos">{lanes.error} <button className={button} onClick={() => void lanes.refresh()}>Retry</button></div>}
      {context && <section className="border border-t-line bg-t-panel p-4 space-y-2" aria-label="Starting from your saved work">
        <h2 className="font-semibold text-t-white">Starting from your saved work</h2>
        <p className="text-sm text-t-phos-dim">{context.target ? `Current goal: ${context.target}. ` : "No goal selected yet. "}Your saved skill labels are starting evidence, not verified qualifications.</p>
        {context.savedSkills.length > 0 ? <div className="flex flex-wrap gap-2">{context.savedSkills.map((skill) => <span key={skill} className="border border-t-line px-2 py-1 text-sm text-t-phos">{skill}</span>)}</div> : <p className="text-sm text-t-phos-dim">No saved skill labels yet. You can add real tasks or skills below.</p>}
        {context.savedConstraints.length > 0 && <p className="text-sm text-t-phos">Already keeping in mind: {context.savedConstraints.join("; ")}.</p>}
      </section>}
      <form onSubmit={compare} className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-5">
        <h2 className="text-lg font-semibold text-t-white">What matters for this search?</h2>
        <p className="text-sm text-t-phos-dim">Add only what is missing. These answers shape this visit; your profile and resumes stay as they are.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-t-phos">When do you need income?<select className={`${field} mt-1`} value={inputs.urgency} onChange={(e) => setInputs({ ...inputs, urgency: e.target.value as PathInputs["urgency"] })}><option value="unknown">Leave open</option><option value="now">Focus on income now</option><option value="explore">I can explore longer routes</option></select></label>
          <label className="text-sm text-t-phos">Training you would consider<select className={`${field} mt-1`} value={inputs.training} onChange={(e) => setInputs({ ...inputs, training: e.target.value as PathInputs["training"] })}><option value="unknown">Leave open</option><option value="on_job">Learning while working</option><option value="short">A short course</option><option value="extended">Longer training or study</option></select></label>
          <label className="text-sm text-t-phos">Where you want to work<input className={`${field} mt-1`} maxLength={160} value={inputs.location} onChange={(e) => setInputs({ ...inputs, location: e.target.value })} placeholder="City and state, or your search area" /></label>
          <label className="text-sm text-t-phos">Hours or schedule needs<input className={`${field} mt-1`} maxLength={160} value={inputs.schedule} onChange={(e) => setInputs({ ...inputs, schedule: e.target.value })} placeholder="Only if you want to add something" /></label>
          <label className="text-sm text-t-phos">Travel or transportation needs<input className={`${field} mt-1`} maxLength={160} value={inputs.transport} onChange={(e) => setInputs({ ...inputs, transport: e.target.value })} placeholder="For example, near a bus route" /></label>
          <label className="text-sm text-t-phos">Other real skills or tasks<input className={`${field} mt-1`} maxLength={1600} value={additional} onChange={(e) => setAdditional(e.target.value)} placeholder="Separate with commas" /></label>
        </div>
        <fieldset><legend className="mb-2 text-sm font-semibold text-t-phos">Work you enjoy or want to try</legend><div className="grid gap-2 sm:grid-cols-3">{Object.entries(PATH_INTERESTS).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-t-phos"><input type="checkbox" className="t-focus" checked={inputs.interests.includes(key as PathInterest)} onChange={(e) => setInputs({ ...inputs, interests: e.target.checked ? [...inputs.interests, key as PathInterest] : inputs.interests.filter((i) => i !== key) })} />{label}</label>)}</div></fieldset>
        <details className="text-sm text-t-phos"><summary className="t-focus cursor-pointer">Skip work categories you do not want to explore</summary><div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(PATH_INTERESTS).map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" className="t-focus" checked={inputs.avoid.includes(key as PathInterest)} onChange={(e) => setInputs({ ...inputs, avoid: e.target.checked ? [...inputs.avoid, key as PathInterest] : inputs.avoid.filter((i) => i !== key) })} />{label}</label>)}</div></details>
        <button className={`${button} bg-t-amber text-white`} disabled={busy || !context || !!lanes.error}>{busy ? "Comparing your directions..." : "Compare directions"}</button>
        {error && <p role="alert" className="text-t-phos">{error} <button type="button" className={button} onClick={() => setReloadKey((key) => key + 1)}>Reload saved context</button></p>}
      </form>
      <section aria-busy={busy} aria-label="Career directions" className="space-y-4">
        <div className="space-y-1"><h2 className="text-xl font-bold text-t-white">Directions to investigate</h2><p className="text-sm text-t-phos-dim">A comparison from {result?.occupationCount ?? 12} sourced occupation groups. The order reflects skill labels, your goal, interests and income timing. It does not predict hiring or check local pay, hours or travel.</p></div>
        {result?.missing.length ? <p className="text-sm text-t-phos">To make this more useful: {result.missing.join("; ")}. You can leave any answer open.</p> : null}
        {choiceError && <p role="alert" className="border border-t-line p-3 text-t-phos">{choiceError}</p>}
        {result && !result.candidates.length && <p role="status" className="border border-t-line p-5 text-t-phos">Your skipped categories cover this starting set. Change a category above, or search for a role you already have in mind.</p>}
        <div className="grid gap-4 lg:grid-cols-2">{result?.candidates.map((candidate) => <article key={candidate.id} className="border border-t-line bg-t-panel p-5 space-y-4">
          <div><p className="text-xs text-t-amber-bright">{candidate.next}</p><h3 className="mt-1 text-xl font-bold text-t-white">{candidate.title}</h3></div>
          <div className="text-sm text-t-phos space-y-2"><p>{candidate.explanation}</p>{candidate.matches.length > 0 && <p><strong>Your starting evidence:</strong> {candidate.matches.map((match) => `${match.label} (${match.origin === "saved_profile" ? "saved profile" : "you added"})`).join("; ")}.</p>}{candidate.interests.length > 0 && <p><strong>Your interests:</strong> {candidate.interests.map((interest) => PATH_INTERESTS[interest]).join(", ")}.</p>}{candidate.targetMatch && <p>Related to your selected goal.</p>}</div>
          <div className="space-y-2 text-sm text-t-phos"><p><strong>The work:</strong> {candidate.tasks}</p><p><strong>Typical entry route:</strong> {candidate.entry}</p></div>
          <details className="text-sm text-t-phos"><summary className="t-focus cursor-pointer font-semibold">What still needs checking</summary><ul className="mt-2 list-disc pl-5 space-y-1">{candidate.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}</ul></details>
          <p className="text-xs text-t-phos-dim"><a className="t-focus underline" href={candidate.source.url} target="_blank" rel="noreferrer">{candidate.source.title}</a>. National overview reviewed {candidate.source.reviewedAt}. Our transfer suggestion uses your inputs; the source does not assess you.</p>
          <div className="flex flex-wrap gap-2"><Link className={button} href={pathJobsHref(candidate.searchRole, result.location, selected?.id === candidate.id ? selected.laneId : undefined)}>Find jobs{result.location ? ` in ${result.location}` : ""}</Link><button type="button" className={button} disabled={!!choosing || busy} onClick={() => { setPending(candidate.id); setChoiceError(""); }}>Choose this direction</button></div>
          {pending === candidate.id && <div className="border border-t-amber p-3 space-y-2 text-sm text-t-phos"><p>Use {candidate.searchRole} as a goal? This selects an existing matching lane or creates one. It adds no skills or qualifications to your history.</p><div className="flex gap-2"><button type="button" className={button} disabled={!!choosing} onClick={() => void choose(candidate)}>{choosing === candidate.id ? "Saving your choice..." : "Confirm direction"}</button><button type="button" className={button} disabled={!!choosing} onClick={() => setPending(null)}>Cancel</button></div></div>}
          {selected?.id === candidate.id && <p role="status" className="text-sm text-t-phos">Your {selected.title} goal is saved and selected.</p>}
        </article>)}</div>
        {context?.target && <Link className={button} href={pathJobsHref(context.target, inputs.location || context.location, context.laneId)}>Search your existing goal: {context.target}</Link>}
      </section>
      <aside className="border-t border-t-line pt-4 text-sm text-t-phos-dim"><p>You can explore before choosing a goal. A role in this guide does not establish your eligibility, a license or an opening.</p><Link className="t-focus mt-2 inline-block text-t-amber-bright underline" href="/dashboard/resources">Need help with transport, training or another practical step? Find support.</Link></aside>
    </div>
  );
}
