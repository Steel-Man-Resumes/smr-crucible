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
import { useLocale, useTranslations } from "next-intl";
import { useLanes } from "@/components/lanes/useLanes";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { FORGE_READING_LABEL, type CareerFact, type ForgeReading } from "@/lib/career-plan/facts";
import { INITIAL_PLANNER_STATE, QUESTIONS, TEXT_MAX, nextQuestion, plannerReducer, progressOf, type Question } from "@/lib/career-plan/questions";
import type { CareerPlan, CareerPlanNote, PlanDirection } from "@/lib/career-plan/plan";
import { chooseCareerDirection } from "@/lib/career-plan/handoff";
import { useServerText } from "@/components/ServerTextProvider";

const btn = "t-focus inline-flex min-h-touch items-center justify-center border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${btn} border-t-amber bg-t-amber text-white hover:bg-t-amber-bright`;
const quiet = `${btn} border-t-line text-t-phos hover:border-t-phos-dim hover:text-t-white`;

export function CareerPlanner() {
  const t = useTranslations("refineryJobs.careerPlanner");
  const tc = useTranslations("common.actions");
  const ts = useServerText();
  const locale = useLocale();
  // The English label stays the one constant (lib/career-plan/facts.ts); Spanish reads the catalog.
  const readingLabel = locale === "en" ? FORGE_READING_LABEL : t("forgeReadingLabel");
  const lanes = useLanes();
  const [state, dispatch] = useReducer(plannerReducer, INITIAL_PLANNER_STATE);
  const [facts, setFacts] = useState<CareerFact[] | null>(null);
  const [reading, setReading] = useState<ForgeReading[]>([]);
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

  // Load on mount and when the account changes; never wait on the lane list (a stuck session must not hang question 1).
  useEffect(() => {
    let live = true;
    setLoadError("");
    fetch("/api/career-plan", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t("loadFailed"));
        if (!live) return;
        setFacts(data.facts ?? []); setReading(data.reading ?? []); setLocation(data.location ?? ""); setNotes(data.notes ?? []);
      })
      .catch((e) => { if (live) { setLoadError(e instanceof Error ? e.message : t("tryAgain")); setFacts([]); } });
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
      if (!r.ok) throw new Error(data.error || t("buildFailed"));
      setPlan(data.plan); if (typeof data.location === "string") setLocation(data.location);
    } catch (e) { setError(e instanceof Error ? e.message : t("tryAgain")); }
    finally { setBusy(false); }
  }

  async function choose(d: PlanDirection) {
    setChoosing(true); setError("");
    try {
      const result = await chooseCareerDirection(d, { laneAtStart: lanes.active, currentLane: () => currentLane.current, location });
      setChosen({ id: d.id, title: d.title, href: result.href, label: d.firstMove.label });
      setConfirming(null);
      window.dispatchEvent(new CustomEvent(LANES_CHANGED_EVENT, { detail: { kind: "list" } }));
    } catch (e) { setError(e instanceof Error ? e.message : t("choiceFailed")); }
    finally { setChoosing(false); }
  }

  async function stillDeciding() {
    if (!plan) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/career-plan/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directionIds: plan.directions.map((d) => d.id), answers: state.answers }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t("noteFailed"));
      setSaved(data.note); setNotes((n) => [data.note, ...n].slice(0, 10)); setStatus(t("savedToNotes"));
    } catch (e) { setError(e instanceof Error ? e.message : t("tryAgain")); }
    finally { setBusy(false); }
  }

  async function deleteNote(id: string) {
    const r = await fetch("/api/career-plan/notes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (r?.ok) { setNotes((n) => n.filter((x) => x.id !== id)); setStatus(t("noteDeleted")); }
    else setError(t("noteNotDeleted"));
  }

  function startOver() { dispatch({ type: "reset" }); setPlan(null); setChosen(null); setSaved(null); setConfirming(null); setError(""); }

  function submit(q: Question, value: unknown) { dispatch({ type: "answer", id: q.id, value }); }

  return (
    <section aria-labelledby="planner-title" className="max-w-3xl space-y-6" data-testid="career-planner">
      <header className="space-y-2">
        <p className="text-sm text-t-amber-bright">{t("breadcrumb")}</p>
        <h1 id="planner-title" className="text-2xl font-bold text-t-white sm:text-3xl">{t("title")}</h1>
        <p className="text-t-phos-dim">{t("intro")}</p>
      </header>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {loadError && <p role="alert" className="border border-t-line p-3 text-sm text-t-phos">{ts(loadError)} {t("canStillAnswer")}</p>}
      {error && <p role="alert" className="border border-t-amber p-3 text-sm text-t-phos">{ts(error)}</p>}

      {!plan && question && (
        <div className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-4" data-testid={`planner-q-${question.id}`}>
          <p className="text-xs text-t-phos-dim">{t("questionOf",{number:progress.done + 1,total:progress.total})}</p>
          <h2 ref={headingRef} tabIndex={-1} id="planner-q" className="text-lg font-semibold text-t-white outline-none">{t(`questions.${question.id}.prompt`)}</h2>
          {question.help && <p id="planner-help" className="text-sm text-t-phos-dim">{t(`questions.${question.id}.help`)}</p>}

          {question.kind === "facts" && (
            <div className="space-y-3">
              {facts === null ? <p className="text-sm text-t-phos-dim">{t("loadingFacts")}</p> : facts.length > 0 ? (
                <fieldset>
                  <legend className="mb-2 text-sm text-t-phos">{t("factsLegend")}</legend>
                  <div className="flex flex-col gap-2">
                    {facts.map((f) => {
                      const on = tapped.includes(f.id);
                      return (
                        <button key={f.id} type="button" aria-pressed={on} onClick={() => setTapped((t) => on ? t.filter((x) => x !== f.id) : [...t, f.id])}
                          className={`t-focus min-h-touch w-full border px-3 py-2 text-left text-sm ${on ? "border-t-amber bg-t-panel-2 text-t-white" : "border-t-line text-t-phos hover:border-t-phos-dim"}`}>
                          <span className="block">{f.text}</span>
                          <span className="block text-xs text-t-phos-dim">{t(`factSource.${f.source}`)}{on ? t("feltGood") : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : <p className="text-sm text-t-phos-dim">{t("noFacts")}</p>}
              {reading.length > 0 && (
                <div className="text-sm text-t-phos-dim">
                  <p>{t("readingLine",{label:readingLabel,list:reading.slice(0, 6).map((r) => r.text).join("; ")})}</p>
                </div>
              )}
              <label className="block text-sm text-t-phos">{t("ownWords")}
                <textarea className="t-focus mt-1 w-full border border-t-line bg-t-panel px-3 py-2 text-t-white" rows={3} maxLength={TEXT_MAX} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-describedby="planner-help" />
              </label>
            </div>
          )}
          {question.kind === "text" && (
            <label className="block text-sm text-t-phos"><span className="sr-only">{t(`questions.${question.id}.prompt`)}</span>
              <textarea className="t-focus w-full border border-t-line bg-t-panel px-3 py-2 text-t-white" rows={3} maxLength={TEXT_MAX} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-describedby={question.help ? "planner-help" : undefined} />
            </label>
          )}
          {question.kind === "number" && (
            <label className="block text-sm text-t-phos">{t("dollarsAnHour")}
              <input inputMode="decimal" className="t-focus mt-1 block w-40 border border-t-line bg-t-panel px-3 py-2 text-t-white" value={draftText} onChange={(e) => setDraftText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} aria-describedby="planner-help" />
            </label>
          )}
          {question.kind === "choice" && (
            <div role="group" aria-labelledby="planner-q" className="grid gap-2 sm:grid-cols-2">
              {question.options!.map((o) => (
                <button key={o.value} type="button" className={`${quiet} justify-start text-left`} onClick={() => submit(question, o.value)}>{t(`questions.${question.id}.options.${o.value}`)}</button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {question.kind === "facts" && <button type="button" className={primary} disabled={facts === null || (!tapped.length && !draftText.trim())} onClick={() => submit(question, { factIds: tapped, text: draftText })}>{tc("next")}</button>}
            {question.kind === "text" && <button type="button" className={primary} disabled={!draftText.trim()} onClick={() => submit(question, draftText)}>{tc("next")}</button>}
            {question.kind === "number" && <button type="button" className={primary} disabled={!(Number(draftText) > 0)} onClick={() => submit(question, draftText)}>{tc("next")}</button>}
            <button type="button" className={quiet} onClick={() => dispatch({ type: "skip", id: question.id })}>{question.kind === "choice" ? t("skipChoice") : t("skipOther")}</button>
            {state.asked.length > 0 && <button type="button" className={quiet} onClick={() => dispatch({ type: "back" })}>{tc("back")}</button>}
          </div>
        </div>
      )}

      {!plan && !question && (
        <div className="border border-t-line bg-t-panel p-4 sm:p-6 space-y-3">
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-t-white outline-none">{t("enoughTitle")}</h2>
          <p className="text-sm text-t-phos-dim">{t("enoughBody")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => void getPlan()}>{busy ? t("working") : t("showThree")}</button>
            <button type="button" className={quiet} onClick={() => dispatch({ type: "back" })}>{tc("back")}</button>
          </div>
        </div>
      )}

      {plan && (
        <div className="space-y-4" aria-busy={busy}>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-t-white outline-none">{t("threeTitle")}</h2>
          <p className="text-sm text-t-phos-dim">{plan.method === "ai" ? t("methodAi") : t("methodRules")}{plan.ruledOut > 0 ? ` ${t("ruledOut",{count:plan.ruledOut})}` : ""}</p>
          {plan.notes.map((n) => <p key={n} role="note" className="border-l-2 border-t-amber pl-3 text-sm text-t-phos">{ts(n)}</p>)}
          <ol className="space-y-4">
            {plan.directions.map((d, i) => (
              <li key={d.id}>
                <article aria-labelledby={`dir-${d.id}`} className={`border bg-t-panel p-4 sm:p-5 space-y-3 ${chosen?.id === d.id ? "border-t-amber" : "border-t-line"}`}>
                  <h3 id={`dir-${d.id}`} className="text-lg font-bold text-t-white"><span className="text-t-phos-dim">{i + 1}. </span>{ts(d.title)}</h3>
                  <p className="text-sm text-t-phos">{ts(d.plain)}</p>
                  <div className="text-sm text-t-phos space-y-1">
                    <p className="font-semibold text-t-white">{t("whyFit")}</p>
                    {d.quotes.length ? d.quotes.map((q) => (
                      <p key={q.factId + q.quote}>{t("youSaid")} <q className="text-t-white">{q.quote}</q> <span className="text-xs text-t-phos-dim">({t(`factSource.${q.source}`)})</span></p>
                    )) : <p className="text-t-phos-dim">{t("noQuotes")}</p>}
                    {d.forgeReading.length > 0 && <p className="text-t-phos-dim">{t("readingLineDir",{label:readingLabel,list:d.forgeReading.join("; ")})}</p>}
                    {d.link && <p>{d.link}</p>}
                  </div>
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                    <dt className="text-t-phos-dim">{t("firstJob")}</dt><dd className="text-t-phos">{ts(d.firstJob)}</dd>
                    <dt className="text-t-phos-dim">{t("laterOn")}</dt><dd className="text-t-phos">{ts(d.laterJob)}</dd>
                    <dt className="text-t-phos-dim">{t("pay")}</dt><dd className="text-t-phos">{d.pay ? `${d.pay.text} (${d.pay.source}, ${d.pay.asOf})` : ts(d.payNote)}</dd>
                    <dt className="text-t-phos-dim">{t("record")}</dt><dd className="text-t-phos">{ts(d.record.note)} <span className="text-xs text-t-phos-dim">({ts(d.record.footer)})</span>{d.record.source && <span className="text-xs text-t-phos-dim"> {t.rich("recordSource",{title:ts(d.record.source.title),date:d.record.source.checkedAt,link:(chunks) => <a className="t-focus underline" href={d.record.source!.url} target="_blank" rel="noreferrer">{chunks}</a>})}</span>}</dd>
                  </dl>
                  <p className="text-xs text-t-phos-dim">{t.rich("aboutWork",{title:ts(d.source.title),date:d.source.reviewedAt,link:(chunks) => <a className="t-focus underline" href={d.source.url} target="_blank" rel="noreferrer">{chunks}<span className="sr-only"> {t("newTab")}</span></a>})}</p>
                  {chosen?.id === d.id ? (
                    <div role="status" className="space-y-2 border border-t-amber p-3 text-sm text-t-phos">
                      <p>{t("laneNow",{title:ts(d.title)})}</p>
                      <Link className={primary} href={chosen.href}>{ts(chosen.label)}</Link>
                    </div>
                  ) : confirming === d.id ? (
                    <div className="space-y-2 border border-t-amber p-3 text-sm text-t-phos">
                      <p>{t("makeLane",{title:ts(d.title),role:d.searchRole})}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={primary} disabled={choosing || !lanes.loaded} onClick={() => void choose(d)}>{choosing ? t("saving") : t("yesGo")}</button>
                        <button type="button" className={quiet} disabled={choosing} onClick={() => setConfirming(null)}>{t("notYet")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={primary} disabled={!!chosen || choosing} onClick={() => setConfirming(d.id)}>{t("pickThis")}</button>
                      <Link className={quiet} href={d.firstMove.href}>{ts(d.firstMove.label)}</Link>
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>

          {!chosen && (
            <div className="border border-t-line bg-t-panel p-4 space-y-3">
              <h3 className="font-semibold text-t-white">{t("stillDecidingTitle")}</h3>
              {saved ? (
                <div role="status" className="space-y-2 text-sm text-t-phos">
                  <p>{t("savedNote")}</p>
                  <p className="font-semibold text-t-white">{t("oneSmallStep")}</p>
                  <Link className={primary} href={plan.nextSmallStep.href}>{ts(plan.nextSmallStep.label)}</Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-t-phos-dim">{t("stillDecidingBody")}</p>
                  <button type="button" className={quiet} disabled={busy} onClick={() => void stillDeciding()}>{busy ? t("saving") : t("stillDecidingButton")}</button>
                </>
              )}
            </div>
          )}
          <button type="button" className={quiet} onClick={startOver}>{tc("startOver")}</button>
        </div>
      )}

      {notes.length > 0 && (
        <details className="border border-t-line p-4 text-sm text-t-phos">
          <summary className="t-focus cursor-pointer font-semibold text-t-white">{t("savedNotes",{count:notes.length})}</summary>
          <ul className="mt-3 space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="border-t border-t-line pt-3 space-y-1">
                <p className="text-xs text-t-phos-dim">{new Date(n.savedAt).toLocaleDateString(locale === "es" ? "es-US" : undefined)}</p>
                <p>{t("lookedAt",{list:n.directions.map((d) => ts(d.title)).join(", ")})}</p>
                {n.choices.length > 0 && <p className="text-t-phos-dim">{t("saidMatters",{list:n.choices.map(ts).join("; ")})}</p>}
                {n.nextStep && <p>{t("nextStep",{text:ts(n.nextStep)})}</p>}
                <button type="button" className={`${quiet} mt-1`} onClick={() => void deleteNote(n.id)}>{t("deleteNote")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
