"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { progressStateLabel, progressPrimaryAction, progressionAllowanceDisplay, safeProgressHref } from "@/lib/progression-ui";
import { PROGRESSION_STEPS, STEP_COPY } from "@/lib/progression-policy";
import { useProgression } from "./ProgressionProvider";

/** The step lines and state words that lib/progression-policy.ts and lib/progression-ui.ts write, by their English text, so the screen can say them in the person's language. Anything else (a server's own wording) shows as it came. */
const KNOWN: Record<string, string> = {
  ...Object.fromEntries(PROGRESSION_STEPS.flatMap((id) => [[STEP_COPY[id].label, `steps.${id}.label`], [STEP_COPY[id].reason, `steps.${id}.reason`]])),
  "Keep your work moving": "keepMoving",
  "Completed": "state.completed",
  "Recommended now · early access": "state.recommendedEarly",
  "Early access": "state.early",
  "Recommended now": "state.recommended",
  "Next · locked": "state.nextLocked",
  "Next · available": "state.nextAvailable",
  "Available": "state.available",
};

export function ProgressAllowance({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("refineryHome.progressOverview");
  const progress = useProgression();
  const data = progress?.data;
  if (!progress || !data) return null;
  const allowance = data.allowance;
  const step = data.steps.find((item) => item.id === data.currentStepId);
  const display = progressionAllowanceDisplay(allowance);
  const expiry = allowance.expiresAt ? new Date(allowance.expiresAt) : null;
  const expiryLabel = expiry && Number.isFinite(expiry.getTime()) ? expiry.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
  return <div className={compact ? "text-xs text-t-phos-dim" : "border border-t-line bg-t-panel-2 p-4 text-sm text-t-phos"}>
    <p>{allowance.enabled && display.remaining !== null ? <><strong className="text-t-white">{display.remaining} {allowance.unit || t("aiActions")}</strong> {display.blockedReason ? t("leftToday") : t("availableCount")}{expiryLabel ? ` ${t("until", { when: expiryLabel })}` : ""}.</> : t("currentAllowance")}</p>
    {!compact ? <p className="mt-1 text-xs leading-relaxed text-t-phos-dim">{allowance.description} {t("limitsApply")}</p> : null}
    {display.blockedReason ? <p role="status" className="mt-2 text-xs text-t-amber-bright">{display.blockedReason}{!compact ? ` ${t("extraNoRemove")}` : ""}</p> : null}
    {!compact && display.canAsk && step ? <button type="button" onClick={() => progress.ask(step, "ai_bonus")} className="t-focus mt-1 inline-flex min-h-touch items-center text-xs text-t-amber-bright underline underline-offset-2">{t("askExtra")}</button> : null}
  </div>;
}

/** Full process uses the same server response as navigation and the workspace bar. */
export function ProgressOverview() {
  const t = useTranslations("refineryHome.progressOverview");
  const words = (text: string): string => (KNOWN[text] ? t(KNOWN[text]) : text);
  const progress = useProgression();
  if (!progress || progress.status === "inactive") return null;
  if (progress.status !== "ready" || !progress.data) return <section aria-label={t("processAria")} className="mb-6 border border-t-line bg-t-panel p-4 text-sm text-t-phos-dim">
    {progress.status === "error" ? <>{t("loadFailed")} <button type="button" onClick={progress.refresh} className="t-focus min-h-touch text-t-amber-bright underline">{t("tryAgain")}</button></> : <p role="status">{t("loading")}</p>}
  </section>;
  const data = progress.data;
  const primary = progressPrimaryAction(data);
  const current = primary.current;
  const requests = data.requests ?? [];
  return <section aria-labelledby="progress-overview-title" className="mb-7 space-y-5 border border-t-line bg-t-panel p-5 sm:p-6">
    <div id="refinery-tool-overview-next" className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim">{primary.override ? t("yourNextAction") : t("yourProcess")}</p><h2 id="progress-overview-title" className="mt-1 text-xl font-bold text-t-white">{words(primary.heading)}</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-t-phos-dim">{primary.override ? t("chosenFirst") : t("oneStep")}</p></div>
      {primary.locked && current ? <button type="button" aria-haspopup="dialog" onClick={() => progress.ask(current)} className="t-focus min-h-touch bg-t-amber px-4 py-3 text-sm font-bold text-white">{t("askOpen")}</button> : <Link href={safeProgressHref(data.nextAction.href)} className="t-focus inline-flex min-h-touch items-center bg-t-amber px-4 py-3 text-sm font-bold text-white">{words(data.nextAction.label)}</Link>}
    </div>
    <details><summary className="t-focus cursor-pointer text-sm font-mono text-purple-300">{t("seeSteps")}</summary>
    <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={t("careerProcessAria")}>
      {data.steps.map((step) => <li key={step.id} className={`min-w-0 border p-3 ${step.state === "current" ? "border-t-amber bg-t-panel-2" : "border-t-line"}`}>
        <div className="flex items-center gap-2 text-xs text-t-phos-dim">{step.access === "locked" ? <LockKeyhole size={14} aria-hidden="true" /> : step.state === "completed" ? <CheckCircle2 size={14} className="text-[#4f6b57]" aria-hidden="true" /> : null}<span>{words(progressStateLabel(step))}</span></div>
        {step.access === "locked" ? <button type="button" aria-haspopup="dialog" onClick={() => progress.ask(step)} className="t-focus mt-1 min-h-touch text-left text-sm font-semibold text-t-white">{words(step.label)}</button> : <Link href={safeProgressHref(step.href)} aria-current={step.state === "current" ? "step" : undefined} className="t-focus mt-1 inline-flex min-h-touch items-center text-sm font-semibold text-t-white underline-offset-2 hover:underline">{words(step.label)}</Link>}
        {step.reason ? <p className="mt-1 text-xs leading-relaxed text-t-phos-dim">{words(step.reason)}</p> : null}
        {step.id === "apply" && step.state === "completed" ? <p className="mt-1 text-xs text-t-phos-dim">{t("appRecorded")}</p> : null}
      </li>)}
    </ol>
    {data.steps.some((step) => step.access === "existing") ? <p className="text-xs text-t-phos-dim">{t("existingAccess")}</p> : null}
    {data.nextReward ? <div className="border-l-4 border-t-amber bg-t-panel-2 px-4 py-3"><p className="text-xs font-semibold text-t-phos-dim">{t("nextReward")}</p><p className="mt-1 text-sm font-semibold text-t-white">{data.nextReward.label}</p>{data.nextReward.requirement ? <p className="mt-1 text-xs text-t-phos-dim">{data.nextReward.requirement}</p> : null}</div> : null}
    <ProgressAllowance />
    <p className="text-xs leading-relaxed text-t-phos-dim">{t("sooner")}</p>
    {current ? <div className="flex flex-wrap gap-4 text-xs"><button type="button" onClick={() => progress.ask(current, "feedback")} className="t-focus min-h-touch text-t-amber-bright underline">{t("shareFeedback")}</button><button type="button" onClick={() => progress.ask(current, "bug")} className="t-focus min-h-touch text-t-amber-bright underline">{t("reportProblem")}</button><p className="w-full text-t-phos-dim">{t("bonusNote")}</p></div> : null}
    {requests.length ? <details className="border-t border-t-line pt-3"><summary className="t-focus min-h-touch cursor-pointer text-sm font-semibold text-t-white">{t("yourRequests")}</summary><ul className="mt-2 space-y-2">{requests.map((request) => <li key={request.id} className="border border-t-line p-3 text-sm"><p className="text-t-white">{words(data.steps.find((step) => step.id === request.stepId)?.label || t("accountRequest"))} · {request.status.replace(/_/g, " ")}</p>{request.decisionNote ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-t-phos-dim">{request.decisionNote}</p> : null}{request.status === "question" && request.idempotencyKey ? <button type="button" aria-haspopup="dialog" onClick={() => progress.reply(request)} className="t-focus mt-2 min-h-touch text-xs text-t-amber-bright underline">{t("replyToTroy")}</button> : null}</li>)}</ul></details> : null}
    </details>
  </section>;
}
