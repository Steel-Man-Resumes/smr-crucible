"use client";

/**
 * Plan what to say: the hurdle planner (Refinery station "Plan what to say").
 *
 * The person picks every hurdle in their way, then each one narrows one
 * question at a time; the next question depends on the last answer
 * (lib/hurdles/graph.ts + reducer.ts, pure and unit tested). Only the record
 * hurdle leads to the conversation plan. Every other hurdle ends in an action
 * plan and the person's own choice about what an employer hears.
 *
 * The plan is built here from the answers with no AI (lib/hurdles/plan.ts).
 * The AI only rewords those answers (/api/hurdle-plan), and any sentence with
 * a fact the answers do not hold is stripped and counted. Record detail goes
 * to the AI only after the record consent below.
 *
 * "Saved" shows only after the artifact write returns ok with a real id
 * (lib/hurdles/save-state.ts). Wording failures show a reason and a retry.
 * Practice receives the plan the person just made.
 */

import { useEffect, useReducer, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffectiveRole } from "@/components/RoleProvider";
import { saveArtifactReceipt } from "@/lib/artifact-save";
import { GhostGuide } from "@crucible/consumer-ui";
import { TierGate } from "@/components/TierGate";
import { getOpusMessage } from "@/lib/opus-messages";
import { escapeHtml } from "@/lib/escape-html";
import { useUserContext } from "@/lib/use-user-context";
import { ConfidenceCoach } from "@/components/ConfidenceCoach";
import { CheckCircle2 } from "lucide-react";
import { RECORD_CHECK_COPY } from "@/lib/record-check/copy";
import { useServerSwitches } from "@/components/ServerSwitches";
import { HurdlePicker } from "@/components/hurdles/HurdlePicker";
import { HurdleQuestion } from "@/components/hurdles/HurdleQuestion";
import { HurdlePlanView, type WordingStatus } from "@/components/hurdles/HurdlePlanView";
import { HURDLES, type HurdleId } from "@/lib/hurdles/graph";
import { INITIAL_STATE, hurdlesOf, plannerReducer, position, reachedAnswers } from "@/lib/hurdles/reducer";
import { coverageOf } from "@/lib/hurdles/coverage";
import { buildHurdlePlan, buildSavePayload, hurdlePlanText, COACHING_LINE, type HurdlePlan } from "@/lib/hurdles/plan";
import { withoutRecordContent } from "@/lib/hurdles/phrase";
import { getNode } from "@/lib/hurdles/graph";
import { applyConstraints } from "@/lib/hurdles/filters";
import { INITIAL_SAVE, runSave, saveReducer } from "@/lib/hurdles/save-state";

type Step = "planner" | "plan" | "rehearse";

interface StrengthProposal { title: string; evidence: string; source: string }
interface ForgeStrength { title: string; evidence: string }
interface ForgeContext {
  headline?: string;
  summary?: string;
  strengths: ForgeStrength[];
  skills: Array<{ name: string; category: string }>;
  careerPaths: Array<{ title: string }>;
}
const EMPTY_FORGE: ForgeContext = { strengths: [], skills: [], careerPaths: [] };

interface Wording {
  status: WordingStatus;
  message: string;
  summaries: Partial<Record<HurdleId, string>>;
  strippedCount: number;
}
const NO_WORDING: Wording = { status: "off", message: "", summaries: {}, strippedCount: 0 };

export default function DisclosurePlannerPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <Suspense><DisclosurePlannerPage /></Suspense>
    </TierGate>
  );
}

function DisclosurePlannerPage() {
  const effectiveRole = useEffectiveRole();
  const searchParams = useSearchParams();
  const { context } = useUserContext();
  const { recordStep } = useServerSwitches();

  const [planner, dispatch] = useReducer(plannerReducer, INITIAL_STATE);
  const [step, setStep] = useState<Step>("planner");
  const [plan, setPlan] = useState<HurdlePlan | null>(null);
  const [wording, setWording] = useState<Wording>(NO_WORDING);
  const [save, saveDispatch] = useReducer(saveReducer, INITIAL_SAVE);
  // Mirrors the save reducer's version: each "changed" bumps both, in order, so a
  // save started right after a change carries the new version even before a render.
  const versionRef = useRef(0);
  const markChanged = () => { versionRef.current += 1; saveDispatch({ type: "changed" }); };
  const payloadRef = useRef<Record<string, unknown> | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [jobFilter, setJobFilter] = useState<{ status: "idle" | "saving" | "saved" | "failed"; message: string }>({ status: "idle", message: "" });

  // Record consent is the person's STORED yes (migration 095, /api/hurdle-plan/consent).
  // Record answers reach an AI service only while it is granted at the current version.
  const [aiConsent, setAiConsent] = useState(false);
  const [consentAsked, setConsentAsked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const [showReading, setShowReading] = useState(false);

  const [targetJob, setTargetJob] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [forge, setForge] = useState<ForgeContext>(EMPTY_FORGE);
  const forgeLoadedRef = useRef(false);
  const [proposals, setProposals] = useState<StrengthProposal[]>([]);
  const [proposalsState, setProposalsState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<{ selected: unknown; choices: unknown } | null>(null);

  const location = [context?.profile?.city, context?.profile?.state].filter(Boolean).join(", ");
  const isRecord = hurdlesOf(planner).includes("record");

  useEffect(() => {
    let live = true;
    fetch("/api/hurdle-plan/consent", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.granted) { setAiConsent(true); setConsentAsked(true); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function answerConsent(yes: boolean) {
    setConsentBusy(true); setConsentError("");
    try {
      if (yes) {
        const r = await fetch("/api/hurdle-plan/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.granted) throw new Error(d?.error || "Your yes did not save, so record answers stay away from the AI. Try again.");
        setAiConsent(true);
      } else {
        if (aiConsent) {
          const r = await fetch("/api/hurdle-plan/consent", { method: "DELETE" });
          if (!r.ok) throw new Error("That did not save. Try again.");
        }
        setAiConsent(false);
      }
      setConsentAsked(true);
    } catch (e) { setConsentError(e instanceof Error ? e.message : "That did not save. Try again."); }
    finally { setConsentBusy(false); }
  }

  // Forge context from the server (strengths stay editable here).
  useEffect(() => {
    if (!context || forgeLoadedRef.current) return;
    forgeLoadedRef.current = true;
    const f = context.forge;
    if (f) {
      setForge({
        headline: f.headline ?? undefined,
        summary: f.summary ?? undefined,
        strengths: (f.strengths ?? []).map((s) => ({ title: s.title, evidence: s.evidence })),
        skills: (f.skills ?? []).map((s) => (typeof s === "string" ? { name: s, category: "" } : { name: s.name, category: s.category ?? "" })),
        careerPaths: (f.careerPaths ?? []).map((c) => ({ title: typeof c === "string" ? c : c.title })),
      });
      if (f.careerPaths?.length) {
        const top = f.careerPaths[0];
        setTargetJob((t) => t || (typeof top === "string" ? top : top.title));
      }
    }
  }, [context]);

  useEffect(() => {
    const company = searchParams.get("company");
    const job = searchParams.get("job");
    if (company) setTargetCompany(company);
    if (job) setTargetJob(job);
  }, [searchParams]);

  useEffect(() => {
    const id = searchParams.get("applicationId");
    if (!id) return;
    let live = true;
    fetch(`/api/application-context?applicationId=${encodeURIComponent(id)}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (!data.application) throw new Error();
      if (!live) return;
      setTargetCompany(data.application.company || "");
      setTargetJob(data.application.job_title || "");
    }).catch(() => live && setApplicationError("This saved job could not be loaded. Check your applications before continuing."));
    return () => { live = false; };
  }, [searchParams]);

  // Offer to pick up the last saved plan's choices (record choices are never saved).
  useEffect(() => {
    let live = true;
    fetch("/api/artifacts?type=disclosure_plan&limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const hp = d?.data?.[0]?.content?.hurdlePlan;
        if (live && hp && Array.isArray(hp.selected) && hp.selected.length) setLastSaved({ selected: hp.selected, choices: hp.choices });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // --- Strength discovery: AI proposes, the person confirms ---
  async function proposeStrengths() {
    setProposalsState("loading");
    try {
      const res = await fetch("/api/disclosure-strengths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetJob: targetJob || undefined,
          forgeContext: forge.headline || forge.strengths.length ? { headline: forge.headline, strengths: forge.strengths.filter((s) => s.title.trim()), skills: forge.skills.slice(0, 8) } : undefined,
        }),
      });
      if (!res.ok) { setProposalsState("error"); return; }
      const data = await res.json();
      const have = new Set(forge.strengths.map((s) => s.title.trim().toLowerCase()));
      setProposals((data.proposals || []).filter((p: StrengthProposal) => p.title && !have.has(p.title.trim().toLowerCase())));
      setProposalsState("done");
    } catch { setProposalsState("error"); }
  }
  function acceptProposal(i: number) {
    const p = proposals[i];
    if (!p) return;
    setForge((prev) => ({ ...prev, strengths: [...prev.strengths, { title: p.title, evidence: p.evidence }] }));
    setProposals((prev) => prev.filter((_, j) => j !== i));
  }
  function updateStrength(i: number, field: "title" | "evidence", value: string) {
    setForge((prev) => ({ ...prev, strengths: prev.strengths.map((s, j) => (j === i ? { ...s, [field]: value } : s)) }));
  }

  // --- Plan, wording, save ---
  function confirmedStrengths(): string[] {
    return forge.strengths.map((s) => s.title.trim()).filter(Boolean).slice(0, 6);
  }

  function buildPayload(p: HurdlePlan, w: Wording): Record<string, unknown> {
    // Never carries the record part (lib/hurdles/plan.ts planForSave).
    return buildSavePayload(p, planner, { summaries: w.summaries, strippedCount: w.strippedCount, wording: w.status, targetJob: targetJob || null, applicationId: searchParams.get("applicationId") || undefined });
  }

  async function doSave() {
    const accountId = effectiveRole?.accountId;
    const payload = payloadRef.current;
    if (!payload) return;
    await runSave({ ...INITIAL_SAVE, version: versionRef.current }, async () => {
      if (!accountId) throw new Error("Your account is still loading.");
      return saveArtifactReceipt(payload, accountId);
    }, (e) => {
      saveDispatch(e);
      if (e.type === "ok") { setShowCelebration(true); window.dispatchEvent(new Event("disclosure-saved")); }
    });
  }

  async function requestWording(): Promise<Wording> {
    const active = hurdlesOf(planner);
    const phrasable = active.some((h) => h !== "not_sure" && (h !== "record" || aiConsent));
    if (!phrasable) return NO_WORDING;
    setWording({ ...NO_WORDING, status: "working" });
    try {
      const res = await fetch("/api/hurdle-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Without the stored yes, record answers and sensitive choices are not even sent.
        body: JSON.stringify({ selected: planner.selected, answers: aiConsent ? reachedAnswers(planner) : withoutRecordContent(reachedAnswers(planner)), targetJob: targetJob || undefined, strengths: confirmedStrengths() }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return { ...NO_WORDING, status: "failed", message: data?.error || "The AI wording didn't come through. Your plan is built from your answers and is complete without it." };
      if (data.status === "nothing_to_phrase") return NO_WORDING;
      return { status: "done", message: "", summaries: data.phrasing?.summaries ?? {}, strippedCount: Number(data.strippedCount) || 0 };
    } catch {
      return { ...NO_WORDING, status: "failed", message: "The connection dropped before the wording came back. Your plan is built from your answers. Try the wording again." };
    }
  }

  async function finishPlan() {
    const p = buildHurdlePlan(planner, { location });
    setPlan(p);
    setStep("plan");
    setJobFilter({ status: "idle", message: "" });
    markChanged();
    window.scrollTo({ top: 0, behavior: "smooth" });
    // t.ROY's reading is off until the person turns it on; the save never holds it.
    setShowReading(false);
    setWording(NO_WORDING);
    payloadRef.current = buildPayload(p, NO_WORDING);
    await doSave();
  }

  async function toggleReading() {
    const next = !showReading;
    setShowReading(next);
    if (next && wording.status !== "done" && wording.status !== "working") await retryWording();
  }

  async function retryWording() {
    if (!plan) return;
    const w = await requestWording();
    setWording(w);
    // The reading is never saved, so new wording does not change the saved plan.
  }

  async function useInJobSearch() {
    if (!plan) return;
    setJobFilter({ status: "saving", message: "" });
    try {
      const current = await fetch("/api/job-search/preferences", { cache: "no-store" });
      const data = await current.json().catch(() => null);
      if (!current.ok || !data) throw new Error(data?.error || "Your job search choices could not be loaded.");
      const filters = applyConstraints(data.saved?.filters, plan.constraints);
      const res = await fetch("/api/job-search/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laneId: data.laneId ?? "main", scope: "lane", revision: data.revision || 0, role: data.saved?.role || targetJob || "", location: data.saved?.location || location || "", filters }),
      });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error || "Your job search choices didn't save.");
      setJobFilter({ status: "saved", message: "Added to your job search filters. You can change them on the Find work page." });
    } catch (error) {
      setJobFilter({ status: "failed", message: `${error instanceof Error ? error.message : "That didn't save."} Try again.` });
    }
  }

  function downloadPlan() {
    if (!plan) return;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const body = hurdlePlanText(plan, wording.summaries as Record<string, string>).split("\n").map((l) => (l ? `<p>${escapeHtml(l)}</p>` : "")).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Your plan</title><style>body{font-family:Georgia,serif;color:#1a1a1a;font-size:12pt;line-height:1.6;margin:0.85in}p{margin:0 0 6pt}.c{border:1pt solid #d4b896;padding:8pt 12pt;margin-bottom:14pt;font-size:10pt}</style></head><body><h1>Your plan${targetJob ? `: ${escapeHtml(targetJob)}` : ""}</h1><p>${date}</p><div class="c"><strong>${COACHING_LINE}</strong> Built from your answers. Anything you didn't answer stays open.</div>${body}</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  /** What practice gets: the person's tell choices. Never the AI reading. */
  function preparedScript(): string {
    if (!plan) return "";
    return plan.hurdles.filter((s) => s.hurdle !== "record" && s.tell).map((s) => `${s.label}: ${s.tell}`).join("\n");
  }

  /** The person's own record lines, for practice only under the stored yes. */
  function recordWords(): string | undefined {
    if (!plan?.record || !aiConsent) return undefined;
    return [plan.record.open, plan.record.next].join("\n");
  }

  async function copyRecordPlan() {
    if (!plan?.record) return;
    const text = [...plan.record.whenToBringItUp, plan.record.open, plan.record.next, plan.record.disclaimer].join("\n");
    try { await navigator.clipboard.writeText(text); setCopyNote("Copied. Paste it somewhere you keep private."); }
    catch { setCopyNote("Copying did not work here. Use Download instead."); }
  }

  const consentCard = (
    <div className="bg-t-panel p-5 border border-t-steel mb-6" data-testid="record-consent">
      <h3 className="font-semibold text-t-white mb-2">Your record answers and AI</h3>
      <div className="text-sm text-t-phos-dim leading-relaxed space-y-2 mb-4">
        <p>The record questions ask where it comes up, the kind of record, how long ago, supervision, and your own words. Every one can be skipped. This plan never asks what happened.</p>
        <p>With your yes, those answers can go to an AI service (our main one, or a backup if it is down) to read your plan back to you, and your own record words go into practice with t.ROY. AI never rewrites your record lines. Without your yes, no record answer goes to any AI.</p>
        <p>Your yes is saved to your account with the date, and you can take it back here any time.</p>
        <p>Your record answers and your record words are never saved: not in your plan, not in your Library, not with a job application. Copy or download them before you leave the page.</p>
      </div>
      {consentError && <p role="alert" className="text-sm text-t-red mb-3">{consentError}</p>}
      <div className="flex flex-wrap gap-3">
        <button disabled={consentBusy} onClick={() => void answerConsent(true)} className="t-focus px-5 py-3 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright min-h-touch disabled:opacity-50">
          Yes, an AI service can use them
        </button>
        <button disabled={consentBusy} onClick={() => void answerConsent(false)} className="t-focus px-4 py-3 text-t-phos-dim text-sm hover:text-t-white min-h-touch disabled:opacity-50">
          No, keep my record answers away from AI
        </button>
      </div>
    </div>
  );

  // --- Rehearse ---
  if (step === "rehearse" && plan) {
    const talkAbout = planner.selected.filter((h) => h !== "not_sure").map((h) => HURDLES[h].label).join(", ");
    return (
      <ConfidenceCoach
        targetJob={targetJob}
        hurdleLabel={talkAbout}
        record={{}}
        strengths={forge.strengths.filter((s) => s.title.trim())}
        forgePromptContext={targetJob ? `TARGET ROLE: ${targetJob}` : ""}
        preparedScript={preparedScript()}
        recordWords={recordWords()}
        onBack={() => setStep("plan")}
      />
    );
  }

  // --- Plan ---
  if (step === "plan" && plan) {
    return (
      <>
        {showCelebration && save.status === "saved" && <SavedToast onDone={() => setShowCelebration(false)} />}
        <HurdlePlanView
          plan={plan}
          wording={wording}
          save={save}
          jobFilter={jobFilter}
          onRetryWording={() => void retryWording()}
          showReading={showReading}
          onToggleReading={() => void toggleReading()}
          onRetrySave={() => void doSave()}
          onUseInJobSearch={() => void useInJobSearch()}
          onPractice={() => { window.scrollTo({ top: 0, behavior: "smooth" }); setStep("rehearse"); }}
          onEdit={() => setStep("planner")}
          onDownload={downloadPlan}
          onCopyRecord={() => void copyRecordPlan()}
          copyNote={copyNote}
        />
      </>
    );
  }

  // --- Narrowing: one question at a time ---
  if (planner.phase === "narrow" && planner.cursor) {
    const pos = position(planner);
    const cov = coverageOf(planner);
    if (getNode(planner.cursor)?.hurdle === "record" && !consentAsked) {
      return (
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-t-white mb-2">Before the record questions</h1>
          <p className="text-sm text-t-phos mb-4">Your answers added the record conversation to your plan. One question first.</p>
          {consentCard}
          {recordStep && <p className="text-sm text-t-phos-dim mb-4">{RECORD_CHECK_COPY.entryQuestion} <a href="/dashboard/record-check" className="underline text-t-steel">{RECORD_CHECK_COPY.entryButton}</a></p>}
          <button onClick={() => dispatch({ type: "back" })} className="t-focus px-3 py-2.5 text-sm text-t-phos-dim hover:text-t-white min-h-touch">Back</button>
        </div>
      );
    }
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-4">Plan what to say</h1>
        <HurdleQuestion
          key={planner.cursor}
          nodeId={planner.cursor}
          answer={planner.answers[planner.cursor]}
          hurdleIndex={pos.hurdleIndex}
          hurdleCount={hurdlesOf(planner).length}
          step={pos.step}
          onAnswer={(v) => dispatch({ type: "answer", nodeId: planner.cursor!, ...v })}
          onSkip={() => dispatch({ type: "skip", nodeId: planner.cursor! })}
          onBack={() => dispatch({ type: "back" })}
        />
        <p className="text-xs text-t-phos-dim mt-3" aria-live="polite">{cov.line}</p>
      </div>
    );
  }

  // --- All answered: review, then build ---
  if (planner.phase === "done") {
    const cov = coverageOf(planner);
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-2">That&apos;s everything on your path</h1>
        <p className="text-sm text-t-phos mb-4">{cov.line}</p>
        <ul className="mb-6 space-y-1">
          {cov.byHurdle.map((c) => (
            <li key={c.hurdle} className="text-sm text-t-phos">
              <span className="text-t-white font-medium">{HURDLES[c.hurdle].label}:</span> {c.answered} answered{c.skipped ? `, ${c.skipped} skipped` : ""}{c.notSure ? `, ${c.notSure} not sure` : ""}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => void finishPlan()} className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright min-h-touch" data-testid="build-plan">
            Build my plan
          </button>
          <button onClick={() => dispatch({ type: "back" })} className="t-focus px-4 py-3 text-sm text-t-phos-dim hover:text-t-white min-h-touch">Back</button>
          <button onClick={() => dispatch({ type: "edit" })} className="t-focus px-4 py-3 text-sm text-t-phos-dim hover:text-t-white min-h-touch">Change hurdles</button>
        </div>
      </div>
    );
  }

  // --- Pick ---
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">Plan what to say</h1>
      <GhostGuide message={getOpusMessage("disclosure")} pageId="disclosure" />
      <p className="text-base text-t-phos-dim mb-6">
        Name what is in your way, work through it one question at a time, and leave with a plan:
        what you know, what is still open, what to do now, who can help, and what you choose to tell an employer.
      </p>

      {lastSaved && (
        <div className="bg-t-panel p-4 border border-t-line mb-6">
          <p className="text-sm text-t-phos mb-2">You have a saved plan. Pick up from its answers? Record answers are never saved, so those questions will ask again.</p>
          <button onClick={() => { dispatch({ type: "restore", selected: lastSaved.selected, answers: lastSaved.choices }); setLastSaved(null); }} className="t-focus px-4 py-2 border border-t-steel text-t-steel text-sm font-bold min-h-touch">
            Pick up where I left off
          </button>
        </div>
      )}

      <HurdlePicker selected={planner.selected} onToggle={(h) => dispatch({ type: "toggle", hurdle: h })} />

      {isRecord && recordStep && (
        <div className="bg-t-panel p-5 border border-t-line mb-6" data-testid="record-check-entry">
          <h3 className="font-semibold text-t-white mb-2">{RECORD_CHECK_COPY.entryQuestion}</h3>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-3">{RECORD_CHECK_COPY.entryBody}</p>
          <a href="/dashboard/record-check" className="t-focus inline-block px-4 py-2.5 border border-t-steel text-t-steel text-sm font-bold min-h-touch">
            {RECORD_CHECK_COPY.entryButton}
          </a>
        </div>
      )}

      {isRecord && !consentAsked && consentCard}
      {isRecord && consentAsked && (
        <p className="text-xs text-t-phos-dim mb-6">
          {aiConsent ? "You said yes: record answers can go to an AI service. " : "Your record answers stay away from every AI. "}
          <button onClick={() => setConsentAsked(false)} className="underline">Change this</button>
        </p>
      )}

      <div className="mb-6">
        <label htmlFor="target-job" className="text-sm font-medium text-t-white block mb-1">
          Target job <span className="font-normal text-t-phos-dim">(optional)</span>
        </label>
        <input
          id="target-job"
          value={targetJob}
          onChange={(e) => setTargetJob(e.target.value)}
          placeholder={forge.careerPaths[0]?.title ? `e.g., ${forge.careerPaths[0].title}` : "e.g., Warehouse Associate"}
          className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
        />
        {applicationError && <p role="alert" className="text-sm text-t-red mt-2">{applicationError}</p>}
        {targetCompany && <p className="text-xs text-t-phos-dim mt-2">Employer: {targetCompany}</p>}
      </div>

      <div className="bg-t-panel p-5 border border-t-line mb-8">
        <h2 className="font-semibold text-t-amber-bright mb-1">Strengths to lead with</h2>
        <p className="text-xs text-t-phos-dim mb-3">From your Forge work, if you have any. Edit them, or ask for suggestions. Nothing is added until you say yes.</p>
        {forge.strengths.map((s, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input aria-label={`Strength ${i + 1}`} value={s.title} onChange={(e) => updateStrength(i, "title", e.target.value)} className="flex-1 px-3 py-2 border border-t-line text-sm text-t-white bg-t-panel-2 focus:border-t-amber focus:outline-none" />
            <button type="button" onClick={() => setForge((p) => ({ ...p, strengths: p.strengths.filter((_, j) => j !== i) }))} aria-label="Remove this strength" className="text-t-phos-dim hover:text-t-red text-xl px-2">&times;</button>
          </div>
        ))}
        {proposalsState !== "loading" && proposals.length === 0 && (
          <button type="button" onClick={() => void proposeStrengths()} className="t-focus mt-1 px-4 py-2 bg-t-steel text-white text-sm font-bold hover:opacity-90 min-h-touch">
            {proposalsState === "done" ? "Look again" : "Suggest strengths from my history"}
          </button>
        )}
        {proposalsState === "loading" && <p className="text-sm text-t-phos mt-2" role="status">Looking through your history...</p>}
        {proposalsState === "done" && proposals.length === 0 && (
          <p className="text-sm text-t-phos mt-2" role="status">No new strengths turned up. Add one yourself: one thing you did that you would want a boss to know.</p>
        )}
        {proposalsState === "error" && <p className="text-sm text-t-amber-bright mt-2" role="alert">Suggestions could not load right now. You can still add strengths yourself.</p>}
        {proposals.map((p, i) => (
          <div key={i} className="bg-t-panel-2 px-4 py-3 border border-t-line mt-2">
            <p className="text-xs text-t-steel font-medium mb-1">Does this describe something you did?</p>
            <p className="text-sm font-medium text-t-white">{p.title}</p>
            <p className="text-xs text-t-phos-dim mb-2">{p.evidence}{p.source ? ` (from your ${p.source})` : ""}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => acceptProposal(i)} className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold">Yes, that&apos;s me</button>
              <button type="button" onClick={() => setProposals((prev) => prev.filter((_, j) => j !== i))} className="px-3 py-1.5 text-t-phos-dim text-xs hover:text-t-white">Not this one</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setForge((p) => ({ ...p, strengths: [...p.strengths, { title: "", evidence: "" }] }))} className="block mt-3 text-sm font-medium text-t-amber-bright hover:text-t-amber">
          + Add a strength
        </button>
      </div>

      <button
        onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); dispatch({ type: "start" }); }}
        disabled={!planner.selected.length || (isRecord && !consentAsked)}
        className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
        data-testid="start-planner"
      >
        {planner.selected.length ? `Start with ${HURDLES[planner.selected[0]].label.toLowerCase()}` : "Pick at least one to start"}
      </button>
      {isRecord && !consentAsked && <p className="text-xs text-t-phos-dim mt-2">Answer the AI question above first. Either answer is fine.</p>}
    </div>
  );
}

function SavedToast({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-[6px] border border-[#b9cdbd] bg-[#e3ede5] px-5 py-3 text-[#344b38] shadow-[0_8px_22px_rgba(22,26,21,0.14)]">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div>
          <p className="m-0 text-sm font-semibold">Plan saved</p>
          <p className="m-0 mt-0.5 text-xs">It&apos;s in your Library</p>
        </div>
      </div>
    </div>
  );
}
