"use client";

/**
 * The lane header (Phase 5 lane R2): "Working toward: <target or a job> ·
 * Today: <task>", with a Change link. On every Forge and Refinery screen
 * inside a lane.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { JourneyProgressBanner } from "@/components/JourneyProgressBanner";
import type { OnboardingState } from "@/lib/useOnboarding";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { LANE_FOCUS_CHANGED_EVENT, useLaneFocus } from "./useLaneFocus";
import { workspaceContextUrl, type RefineryWorkspaceContext } from "@/lib/refinery-workspace";
import { CHANGE_HREF, type LaneTask } from "@/lib/lane-task";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { ProgressAllowance } from "@/components/progression/ProgressOverview";

export function LaneHeader({ task, target, changeHref = CHANGE_HREF, className = "" }: { task: LaneTask; target?: string | null; changeHref?: string; className?: string }) {
  const t = useTranslations("forgeEntry.laneHeader");
  const tTask = useTranslations("forgeEntry.tasks");
  // "Working toward: forklift driver · Today: your resume" (same trimming as laneHeaderLine in lib/lane-task.ts).
  const toward = (target ?? "").replace(/\s+/g, " ").trim() || t("aJob");
  const today = tTask(`${task}.today`);
  return (
    <div
      role="note"
      aria-label={t("ariaLabel")}
      data-testid="lane-header"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-t-line bg-t-panel px-4 py-2 text-sm sm:px-6 ${className}`}
    >
      <span className="min-w-0 text-t-phos">
        <span className="text-t-phos-dim">{t("workingToward")}</span> <span className="font-semibold text-t-white" data-testid="lane-toward">{toward}</span>
        <span aria-hidden="true" className="px-1.5 text-t-phos-dim">·</span>
        <span className="text-t-phos-dim">{t("today")}</span> <span className="font-semibold text-t-white" data-testid="lane-today">{today}</span>
      </span>
      <Link href={changeHref} className="t-focus inline-flex min-h-touch items-center text-sm font-medium text-t-amber-bright underline underline-offset-2 hover:text-t-amber" data-testid="lane-change">
        {t("change")}
      </Link>
    </div>
  );
}

/** One compact sticky surface belongs to the shell, outside the page heading. */
export function RefineryLaneHeader({ state }: { state: OnboardingState }) {
  const t = useTranslations("forgeEntry.laneHeader");
  const progression = useProgression();
  const focus = useLaneFocus();
  const pathname = usePathname();
  const params = useSearchParams();
  const userId = useSession().data?.user?.id;
  const url = workspaceContextUrl(pathname, new URLSearchParams(params.toString()), focus.laneId);
  const requestKey = `${userId}:${url}`;
  const [result, setResult] = useState<{ key: string; data: RefineryWorkspaceContext | null; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!userId || !focus.loaded) return;
    let live = true;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      setResult(null);
      fetch(url, { cache: "no-store", signal: current.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Workspace unavailable");
          const body = await response.json();
          if (!body?.data) throw new Error("Workspace unavailable");
          if (live && !current.signal.aborted) setResult({ key: requestKey, data: body.data, error: false });
        })
        .catch(() => { if (live && !current.signal.aborted) setResult({ key: requestKey, data: null, error: true }); });
    };
    load();
    const events = [LANES_CHANGED_EVENT, LANE_FOCUS_CHANGED_EVENT, "resume-saved", "forge-synced", "next-step-changed"];
    events.forEach((event) => window.addEventListener(event, load));
    return () => { live = false; controller?.abort(); events.forEach((event) => window.removeEventListener(event, load)); };
  }, [url, requestKey, focus.loaded, userId, retry]);

  const current = result?.key === requestKey ? result : null;
  const work = current?.data;
  const laneLabel = work ? work.lane?.target || work.lane?.name || t("mainLane") : current?.error ? t("unavailable") : t("loading");
  return (
    <section id="refinery-workspace-context" aria-label={t("workspaceAria")} data-testid="refinery-workspace-context"
      className="relative z-20 border-b border-t-line bg-t-panel/95 px-4 py-2 shadow-[0_2px_7px_rgba(22,26,21,0.06)] backdrop-blur sm:px-7 lg:px-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-sm text-t-white"><span className="text-t-bone-dim">{t("workingToward")}</span> <strong>{laneLabel}</strong>
          {work && <Link href="/dashboard?change=1" className="t-focus ml-3 inline-flex min-h-touch items-center text-xs text-t-amber-bright underline underline-offset-2"><span className="sm:hidden">{t("change")}</span><span className="hidden sm:inline">{t("changeTask")}</span></Link>}
          {current?.error && <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus ml-3 min-h-touch text-xs text-t-amber-bright underline">{t("retry")}</button>}
        </p>
        <JourneyProgressBanner state={state} work={work || null} contextStatus={current?.error ? "error" : work ? "ready" : "loading"} contextKey={requestKey} />
      </div>
      <details className="mt-1 text-xs text-t-bone-dim"><summary className="t-focus cursor-pointer py-1 font-mono text-purple-300">{t("details")}</summary>
      {work && <p className="flex flex-wrap gap-x-4 text-xs leading-6 text-t-bone-dim sm:flex">
        {work.lane && work.lane.name !== work.lane.target && <span>{t("laneName", { name: work.lane.name })}</span>}
        {work.application && <span>{t("applicationLabel")} <Link href={`/dashboard/application-tailor?job=${encodeURIComponent(work.application.id)}`} className="t-focus text-t-white underline underline-offset-2">{work.application.company ? t("jobAtCompany", { title: work.application.job_title, company: work.application.company }) : work.application.job_title}</Link></span>}
        <span>{work.revision ? <><span>{t("currentResume")} </span><Link href={`/dashboard/application-tailor?id=${encodeURIComponent(work.revision.artifactId)}`} className="t-focus text-t-white underline underline-offset-2">{t("versionStatus", { number: work.revision.number, status: work.revision.status === "finished" ? t("statusFinished") : work.revision.status === "draft" ? t("statusDraft") : work.revision.status })}</Link></> : work.lane && work.lane.kind && work.lane.kind !== "resume" ? t("laneDocTool") : work.selection?.artifactId ? <><span>{t("currentResume")} </span><Link href={`/dashboard/application-tailor?id=${encodeURIComponent(work.selection.artifactId)}`} className="t-focus text-t-white underline underline-offset-2">{t("savedNoChecked")}</Link></> : t("noResumeVersion")}</span>
      </p>}
      {progression?.data ? <div className="flex flex-wrap items-center gap-x-4 text-xs leading-6 text-t-bone-dim">
        <ProgressAllowance compact />
        {progression.data.nextReward ? <span className="max-w-sm truncate" title={progression.data.nextReward.requirement}>{t("nextReward", { label: progression.data.nextReward.label })}</span> : null}
      </div> : null}
      <Link href="/dashboard/master" className="t-focus inline-flex min-h-touch items-center text-purple-300 underline">{t("masterDraft")}</Link>
      </details>
    </section>
  );
}
