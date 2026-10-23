"use client";

import Link from "next/link";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { progressStateLabel, progressPrimaryAction, progressionAllowanceDisplay, safeProgressHref } from "@/lib/progression-ui";
import { useProgression } from "./ProgressionProvider";

export function ProgressAllowance({ compact = false }: { compact?: boolean }) {
  const progress = useProgression();
  const data = progress?.data;
  if (!progress || !data) return null;
  const allowance = data.allowance;
  const step = data.steps.find((item) => item.id === data.currentStepId);
  const display = progressionAllowanceDisplay(allowance);
  const expiry = allowance.expiresAt ? new Date(allowance.expiresAt) : null;
  const expiryLabel = expiry && Number.isFinite(expiry.getTime()) ? expiry.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
  return <div className={compact ? "text-xs text-t-phos-dim" : "border border-t-line bg-t-panel-2 p-4 text-sm text-t-phos"}>
    <p>{allowance.enabled && display.remaining !== null ? <><strong className="text-t-white">{display.remaining} {allowance.unit || "AI actions"}</strong> {display.countLabel}{expiryLabel ? ` until ${expiryLabel}` : ""}.</> : "Your current allowance"}</p>
    {!compact ? <p className="mt-1 text-xs leading-relaxed text-t-phos-dim">{allowance.description} Account and operation limits still apply.</p> : null}
    {display.blockedReason ? <p role="status" className="mt-2 text-xs text-t-amber-bright">{display.blockedReason}{!compact ? " Extra actions do not remove this limit." : ""}</p> : null}
    {!compact && display.canAsk && step ? <button type="button" onClick={() => progress.ask(step, "ai_bonus")} className="t-focus mt-1 inline-flex min-h-touch items-center text-xs text-t-amber-bright underline underline-offset-2">Ask for extra AI actions</button> : null}
  </div>;
}

/** Full process uses the same server response as navigation and the workspace bar. */
export function ProgressOverview() {
  const progress = useProgression();
  if (!progress || progress.status === "inactive") return null;
  if (progress.status !== "ready" || !progress.data) return <section aria-label="Your process" className="mb-6 border border-t-line bg-t-panel p-4 text-sm text-t-phos-dim">
    {progress.status === "error" ? <>Your process could not be loaded. Your saved work is still available. <button type="button" onClick={progress.refresh} className="t-focus min-h-touch text-t-amber-bright underline">Try again</button></> : <p role="status">Loading your process...</p>}
  </section>;
  const data = progress.data;
  const primary = progressPrimaryAction(data);
  const current = primary.current;
  const requests = data.requests ?? [];
  return <section aria-labelledby="progress-overview-title" className="mb-7 space-y-5 border border-t-line bg-t-panel p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim">{primary.override ? "Your next action" : "Your process"}</p><h2 id="progress-overview-title" className="mt-1 text-xl font-bold text-t-white">{primary.heading}</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-t-phos-dim">{primary.override ? "Your chosen work comes first. Your saved process is shown below." : "One saved step at a time. Early access and completed preparation are shown separately."}</p></div>
      {primary.locked && current ? <button type="button" aria-haspopup="dialog" onClick={() => progress.ask(current)} className="t-focus min-h-touch bg-t-amber px-4 py-3 text-sm font-bold text-white">Ask t.ROY to open this</button> : <Link href={safeProgressHref(data.nextAction.href)} className="t-focus inline-flex min-h-touch items-center bg-t-amber px-4 py-3 text-sm font-bold text-white">{data.nextAction.label}</Link>}
    </div>
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Career process">
      {data.steps.map((step) => <li key={step.id} className={`min-w-0 border p-3 ${step.state === "current" ? "border-t-amber bg-t-panel-2" : "border-t-line"}`}>
        <div className="flex items-center gap-2 text-xs text-t-phos-dim">{step.access === "locked" ? <LockKeyhole size={14} aria-hidden="true" /> : step.state === "completed" ? <CheckCircle2 size={14} className="text-[#4f6b57]" aria-hidden="true" /> : null}<span>{progressStateLabel(step)}</span></div>
        {step.access === "locked" ? <button type="button" aria-haspopup="dialog" onClick={() => progress.ask(step)} className="t-focus mt-1 min-h-touch text-left text-sm font-semibold text-t-white">{step.label}</button> : <Link href={safeProgressHref(step.href)} aria-current={step.state === "current" ? "step" : undefined} className="t-focus mt-1 inline-flex min-h-touch items-center text-sm font-semibold text-t-white underline-offset-2 hover:underline">{step.label}</Link>}
        {step.reason ? <p className="mt-1 text-xs leading-relaxed text-t-phos-dim">{step.reason}</p> : null}
        {step.id === "apply" && step.state === "completed" ? <p className="mt-1 text-xs text-t-phos-dim">Application recorded by you.</p> : null}
      </li>)}
    </ol>
    {data.steps.some((step) => step.access === "existing") ? <p className="text-xs text-t-phos-dim">Your existing tool access is retained. The process shows preparation you can build on.</p> : null}
    {data.nextReward ? <div className="border-l-4 border-t-amber bg-t-panel-2 px-4 py-3"><p className="text-xs font-semibold text-t-phos-dim">Next reward</p><p className="mt-1 text-sm font-semibold text-t-white">{data.nextReward.label}</p>{data.nextReward.requirement ? <p className="mt-1 text-xs text-t-phos-dim">{data.nextReward.requirement}</p> : null}</div> : null}
    <ProgressAllowance />
    <p className="text-xs leading-relaxed text-t-phos-dim">Need a guided tool sooner? Use its lock to ask t.ROY. Support, practice and your saved documents stay reachable. Public reviews are optional and do not earn AI credits.</p>
    {current ? <div className="flex flex-wrap gap-4 text-xs"><button type="button" onClick={() => progress.ask(current, "feedback")} className="t-focus min-h-touch text-t-amber-bright underline">Share honest feedback</button><button type="button" onClick={() => progress.ask(current, "bug")} className="t-focus min-h-touch text-t-amber-bright underline">Report a problem</button><p className="w-full text-t-phos-dim">Useful feedback or a reproducible bug may earn a small AI bonus after review. Good or bad, tell us what happened.</p></div> : null}
    {requests.length ? <details className="border-t border-t-line pt-3"><summary className="t-focus min-h-touch cursor-pointer text-sm font-semibold text-t-white">Your access requests</summary><ul className="mt-2 space-y-2">{requests.map((request) => <li key={request.id} className="border border-t-line p-3 text-sm"><p className="text-t-white">{data.steps.find((step) => step.id === request.stepId)?.label || "Account request"} · {request.status.replace(/_/g, " ")}</p>{request.decisionNote ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-t-phos-dim">{request.decisionNote}</p> : null}{request.status === "question" && request.idempotencyKey ? <button type="button" aria-haspopup="dialog" onClick={() => progress.reply(request)} className="t-focus mt-2 min-h-touch text-xs text-t-amber-bright underline">Reply to Troy</button> : null}</li>)}</ul></details> : null}
  </section>;
}
