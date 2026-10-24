"use client";

/**
 * "I don't know what I want yet" (magnum B6): the career planner for the
 * person with no lane. One short question per screen, starting from their
 * own saved work (loaded from the server, never from this browser), then
 * three directions. Choosing one creates or switches to a career lane through
 * the existing lane path and sets the lane focus. "Still deciding" saves a
 * note to the person's own profile and shows one small next step.
 */

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { useLanes } from "@/components/lanes/useLanes";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { FACT_SOURCE_LABEL, type CareerFact } from "@/lib/career-plan/facts";
import { INITIAL_PLANNER_STATE, QUESTIONS, SKIP_LABEL, TEXT_MAX, nextQuestion, plannerReducer, progressOf, type Question } from "@/lib/career-plan/questions";
import type { CareerPlan, CareerPlanNote, PlanDirection } from "@/lib/career-plan/plan";
import { chooseCareerDirection } from "@/lib/career-plan/handoff";

const btn = "t-focus inline-flex min-h-touch items-center justify-center border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${btn} border-t-amber bg-t-amber text-white hover:bg-t-amber-bright`;
const quiet = `${btn} border-t-line text-t-phos hover:border-t-phos-dim hover:text-t-white`;

export function CareerPlanner() {
  const lanes = useLanes();
  const [state, dispatch] = useReducer(plannerReducer, INITIAL_PLANNER_STATE);
  const [facts, setFacts] = useState<CareerFact[] | null>(null);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState<CareerPlanNote[]>([]);
  const [loadError, setLoadError] = useState("");
  const [plan, setPlan] = useState<CareerPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [tapped, setTapped] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; title: string; href: string; label: string } | null>(null);
  const [saved, setSaved] = useState<CareerPlanNote | null>(null);
  const [status, setStatus] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentLane = useRef(lanes.active);
  currentLane.current = lanes.active;

  useEffect(() => {
    if (!lanes.userId) return;
    let live = true;
    setLoadError("");
    fetch("/api/career-plan", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Your saved work couldn't be loaded.");
        if (!live) return;
        setFacts(data.facts ?? []); setLocation(data.location ?? ""); setNotes(data.notes ?? []);
      })
      .catch((e) => { if (live) { setLoadError(e instanceof Error ? e.message : "Try again."); setFacts([]); } });
    return () => { live = false; };
  }, [lanes.userId]);

  const question = plan ? null : nextQuestion(state);
  const progress = progressOf(state);
  // Each new screen starts clean and, after the first, moves focus to its question.
  const firstScreen = useRef(true);
  useEffect(() => {
    setDraftText(""); setTapped([]);
    if (firstScreen.current) { firstScreen.current = false; return; }
    headingRef.current?.focus();
  }, [question?.id, plan]);

  async function getPlan() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/career-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: state.answers }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Your directions couldn't be built.");
      setPlan(data.plan); if (typeof data.location === "string") setLocation(data.location);
    } catch (e) { setError(e instanceof Error ? e.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function choose(d: PlanDirection) {
    setChoosing(true); setError("");
    try {
      const result = await chooseCareerDirection(d, { laneAtStart: lanes.active, currentLane: () => currentLane.current, location });
      setChosen({ id: d.id, title: d.title, href: result.href, label: d.firstMove.label });
      setConfirming(null);
      window.dispatchEvent(new CustomEvent(LANES_CHANGED_EVENT, { detail: { kind: "list" } }));
    } catch (e) { setError(e instanceof Error ? e.message : "That choice wasn't saved. Try again."); }
    finally { setChoosing(false); }
  }

  async function stillDeciding() {
    if (!plan) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/career-plan/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directionIds: plan.directions.map((d) => d.id), answers: state.answers }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Your note wasn't saved.");
      setSaved(data.note); setNotes((n) => [data.note, ...n].slice(0, 10)); setStatus("Saved to your notes.");
    } catch (e) { setError(e instanceof Error ? e.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function deleteNote(id: string) {
    const r = await fetch("/api/career-plan/notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (r?.ok) { setNotes((n) => n.filter((x) => x.id !== id)); setStatus("Note deleted."); }
    else setError("That note wasn't deleted. Try again.");
  }

  function startOver() { dispatch({ type: "reset" }); setPlan(null); setChosen(null); setSaved(null); setConfirming(null); setError(""); }

  function submit(q: Question, value: unknown) { dispatch({ type: "answer", id: q.id, value }); }

  return (
    <section aria-labelledby="planner-title" className="max-w-3xl space-y-6" data-testid="career-planner">
      <header className="space-y-2">
        <p className="text-sm text-t-amber-bright">Find work / Pick a direction</p>
        <h1 id="planner-title" className="text-2xl font-bold text-t-white sm:text-3xl">Don&apos;t know what you want yet? Good place to start.</h1>
        <p className="text-t-phos-dim">I&apos;ll ask a few short questions, starting with work you&apos;ve already done. Skip anything you want. You get three directions to look at. You pick one, or you don&apos;t. Both are fine.</p>
      </header>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {loadError && <p role="alert" className="border border-t-line p-3 text-sm text-t-phos">{loadError} You can still answer the questions.</p>}
      {error && <p role="alert" className="border border-t-amber p-3 text-sm text-t-phos">{error}</p>}

      {!plan && question && (
        <div className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-4" data-testid={`planner-q-${question.id}`}>
          <p className="text-xs text-t-phos-dim">Question {progress.done + 1} of {progress.total}</p>
          <h2 ref={headingRef} tabIndex={-1} id="planner-q" className="text-lg font-semibold text-t-white outline-none">{question.prompt}</h2>
          {question.help && <p id="planner-help" className="text-sm text-t-phos-dim">{question.help}</p>}

          {question.kind === "facts" && (
            <div className="space-y-3">
              {facts === null ? <p className="text-sm text-t-phos-dim">Loading what you&apos;ve told us...</p> : facts.length > 0 ? (
                <fieldset>
                  <legend className="mb-2 text-sm text-t-phos">What you&apos;ve told us so far</legend>
                  <div className="flex flex-col gap-2">
                    {facts.map((f) => {
                      const on = tapped.includes(f.id);
                      return (
                        <button key={f.id} type="button" aria-pressed={on} onClick={() => setTapped((t) => on ? t.filter((x) => x !== f.id) : [...t, f.id])}
                          className={`t-focus min-h-touch w-full border px-3 py-2 text-left text-sm ${on ? "border-t-amber bg-t-panel-2 text-t-white" : "border-t-line text-t-phos hover:border-t-phos-dim"}`}>
                          <span className="block">{f.text}</span>
                          <span className="block text-xs text-t-phos-dim">{FACT_SOURCE_LABEL[f.source]}{on ? ". Felt good." : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : <p className="text-sm text-t-phos-dim">We don&apos;t have your work saved yet. That&apos;s fine. Just tell me.</p>}
              <label className="block text-sm text-t-phos">Your own words (optional)
                <textarea className="t-focus mt-1 w-full border border-t-line bg-t-panel px-3 py-2 text-t-white" rows={3} maxLength={TEXT_MAX} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-describedby="planner-help" />
              </label>
            </div>
          )}
          {question.kind === "text" && (
            <label className="block text-sm text-t-phos"><span className="sr-only">{question.prompt}</span>
              <textarea className="t-focus w-full border border-t-line bg-t-panel px-3 py-2 text-t-white" rows={3} maxLength={TEXT_MAX} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-describedby={question.help ? "planner-help" : undefined} />
            </label>
          )}
          {question.kind === "number" && (
            <label className="block text-sm text-t-phos">Dollars an hour
              <input inputMode="decimal" className="t-focus mt-1 block w-40 border border-t-line bg-t-panel px-3 py-2 text-t-white" value={draftText} onChange={(e) => setDraftText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} aria-describedby="planner-help" />
            </label>
          )}
          {question.kind === "choice" && (
            <div role="group" aria-labelledby="planner-q" className="grid gap-2 sm:grid-cols-2">
              {question.options!.map((o) => (
                <button key={o.value} type="button" className={`${quiet} justify-start text-left`} onClick={() => submit(question, o.value)}>{o.label}</button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {question.kind === "facts" && <button type="button" className={primary} disabled={facts === null || (!tapped.length && !draftText.trim())} onClick={() => submit(question, { factIds: tapped, text: draftText })}>Next</button>}
            {question.kind === "text" && <button type="button" className={primary} disabled={!draftText.trim()} onClick={() => submit(question, draftText)}>Next</button>}
            {question.kind === "number" && <button type="button" className={primary} disabled={!(Number(draftText) > 0)} onClick={() => submit(question, draftText)}>Next</button>}
            <button type="button" className={quiet} onClick={() => dispatch({ type: "skip", id: question.id })}>{question.kind === "choice" ? SKIP_LABEL : "I'm not sure. Skip it."}</button>
            {state.asked.length > 0 && <button type="button" className={quiet} onClick={() => dispatch({ type: "back" })}>Back</button>}
          </div>
        </div>
      )}

      {!plan && !question && (
        <div className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-3">
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-t-white outline-none">That&apos;s enough to go on.</h2>
          <p className="text-sm text-t-phos-dim">I&apos;ll match what you said against real kinds of work. Nothing gets added to your history.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void getPlan()}>{busy ? "Working on it..." : "Show me three directions"}</button>
            <button type="button" className={quiet} onClick={() => dispatch({ type: "back" })}>Back</button>
          </div>
        </div>
      )}

      {plan && (
        <div className="space-y-4" aria-busy={busy}>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-t-white outline-none">Three directions worth a look</h2>
          <p className="text-sm text-t-phos-dim">{plan.method === "ai" ? "t.ROY picked these from your answers. Every quote below is checked against what you told us." : "These come from matching your own words against real kinds of work."}{plan.ruledOut > 0 ? ` Your answers ruled out ${plan.ruledOut} other kinds of work.` : ""}</p>
          {plan.notes.map((n) => <p key={n} role="note" className="border-l-2 border-t-amber pl-3 text-sm text-t-phos">{n}</p>)}
          <ol className="space-y-4">
            {plan.directions.map((d, i) => (
              <li key={d.id}>
                <article aria-labelledby={`dir-${d.id}`} className={`border bg-t-panel p-4 sm:p-5 space-y-3 ${chosen?.id === d.id ? "border-t-amber" : "border-t-line"}`}>
                  <h3 id={`dir-${d.id}`} className="text-lg font-bold text-t-white"><span className="text-t-phos-dim">{i + 1}. </span>{d.title}</h3>
                  <p className="text-sm text-t-phos">{d.plain}</p>
                  <div className="text-sm text-t-phos space-y-1">
                    <p className="font-semibold text-t-white">Why it might fit you</p>
                    {d.quotes.length ? d.quotes.map((q) => (
                      <p key={q.factId + q.quote}>You said: <q className="text-t-white">{q.quote}</q> <span className="text-xs text-t-phos-dim">({FACT_SOURCE_LABEL[q.source]})</span></p>
                    )) : <p className="text-t-phos-dim">Nothing you&apos;ve told us ties to this one yet. It&apos;s here because it fits your answers.</p>}
                    {d.link && <p>{d.link}</p>}
                  </div>
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                    <dt className="text-t-phos-dim">First job</dt><dd className="text-t-phos">{d.firstJob}</dd>
                    <dt className="text-t-phos-dim">Later on</dt><dd className="text-t-phos">{d.laterJob}</dd>
                    <dt className="text-t-phos-dim">Pay</dt><dd className="text-t-phos">{d.pay ? `${d.pay.text} (${d.pay.source}, ${d.pay.asOf})` : d.payNote}</dd>
                    <dt className="text-t-phos-dim">A record</dt><dd className="text-t-phos"><strong className="font-semibold">{d.record.label}.</strong> {d.record.note} <span className="text-xs text-t-phos-dim">{d.record.footer}</span></dd>
                  </dl>
                  <p className="text-xs text-t-phos-dim">About the work: <a className="t-focus underline" href={d.source.url} target="_blank" rel="noreferrer">{d.source.title}<span className="sr-only"> (opens in a new tab)</span></a>, US overview, checked {d.source.reviewedAt}.</p>
                  {chosen?.id === d.id ? (
                    <div role="status" className="space-y-2 border border-t-amber p-3 text-sm text-t-phos">
                      <p>{d.title} is your lane now. First move:</p>
                      <Link className={primary} href={chosen.href}>{chosen.label}</Link>
                    </div>
                  ) : confirming === d.id ? (
                    <div className="space-y-2 border border-t-amber p-3 text-sm text-t-phos">
                      <p>Make {d.title.toLowerCase()} your lane? This opens a {d.searchRole.toLowerCase()} lane or uses one you already have. It adds nothing to your work history.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={primary} disabled={choosing || !lanes.loaded} onClick={() => void choose(d)}>{choosing ? "Saving..." : "Yes, go with this"}</button>
                        <button type="button" className={quiet} disabled={choosing} onClick={() => setConfirming(null)}>Not yet</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={primary} disabled={!!chosen || choosing} onClick={() => setConfirming(d.id)}>Pick this one</button>
                      <Link className={quiet} href={d.firstMove.href}>{d.firstMove.label}</Link>
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>

          {!chosen && (
            <div className="border border-t-line bg-t-panel p-4 space-y-3">
              <h3 className="font-semibold text-t-white">Still deciding?</h3>
              {saved ? (
                <div role="status" className="space-y-2 text-sm text-t-phos">
                  <p>Saved to your notes. Your choices and these three directions are saved. Your own words from today are not.</p>
                  <p className="font-semibold text-t-white">One small step:</p>
                  <Link className={primary} href={plan.nextSmallStep.href}>{plan.nextSmallStep.label}</Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-t-phos-dim">That&apos;s a real answer. Save these to your notes and come back when you&apos;re ready.</p>
                  <button type="button" className={quiet} disabled={busy} onClick={() => void stillDeciding()}>{busy ? "Saving..." : "I'm still deciding. Save this."}</button>
                </>
              )}
            </div>
          )}
          <button type="button" className={quiet} onClick={startOver}>Start over</button>
        </div>
      )}

      {notes.length > 0 && (
        <details className="border border-t-line p-4 text-sm text-t-phos">
          <summary className="t-focus cursor-pointer font-semibold text-t-white">Your saved notes ({notes.length})</summary>
          <ul className="mt-3 space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="border-t border-t-line pt-3 space-y-1">
                <p className="text-xs text-t-phos-dim">{new Date(n.savedAt).toLocaleDateString()}</p>
                <p>Looked at: {n.directions.map((d) => d.title).join(", ")}</p>
                {n.choices.length > 0 && <p className="text-t-phos-dim">What you said matters: {n.choices.join("; ")}</p>}
                {n.nextStep && <p>Next step: {n.nextStep}</p>}
                <button type="button" className={`${quiet} mt-1`} onClick={() => void deleteNote(n.id)}>Delete this note</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
