"use client";

/**
 * What is really happening with the build, and nothing more. /api/analyze
 * does not stream, so the only true steps are: the request went out, it is
 * being worked on (with the real time so far), and it came back. No
 * percentages, no made-up stages.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { elapsedLabel } from "@/lib/showstopper-tour";

export type BuildPhase = "sending" | "working" | "done";

/** Past this many seconds the screen says plainly that it is running long. */
export const LONG_RUN_SECONDS = 90;

function WorkMark() { return <TroyWork compact decorative />; }

function Mark({ state }: { state: "done" | "active" | "waiting" }) {
  if (state === "done")
    return (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-t-amber text-ws-bg" aria-hidden="true">
        <Check size={11} strokeWidth={3} />
      </span>
    );
  if (state === "active") return <WorkMark />;
  return <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-t-line" aria-hidden="true" />;
}

export function BuildStatus({ phase, elapsed }: { phase: BuildPhase; elapsed: number }) {
  const t = useTranslations("forgeProcessing");
  const long = phase === "working" && elapsed >= LONG_RUN_SECONDS;
  const working: "done" | "active" | "waiting" = phase === "done" ? "done" : phase === "working" ? "active" : "waiting";

  return (
    <div className="border border-t-line bg-t-panel px-4 py-3">
      <ol className="flex flex-col gap-2 font-term text-sm sm:flex-row sm:items-center sm:gap-6" aria-label={t("status.aria")}>
        <li className="flex items-center gap-2 text-t-white">
          <Mark state={phase === "sending" ? "active" : "done"} />
          <span>{t("status.sent")}</span>
        </li>
        <li className={`flex items-center gap-2 ${working === "waiting" ? "text-t-bone-dim" : "text-t-white"}`}>
          <Mark state={working} />
          <span>{t("status.working")}</span>
          {phase === "working" && (
            <span role="timer" className="tabular-nums text-t-amber-bright" aria-label={t("status.secondsSoFar", { seconds: Math.floor(elapsed) })}>
              {elapsedLabel(elapsed)}
            </span>
          )}
        </li>
        <li className={`flex items-center gap-2 ${phase === "done" ? "text-t-white" : "text-t-bone-dim"}`}>
          <Mark state={phase === "done" ? "done" : "waiting"} />
          <span>{t("status.done")}</span>
        </li>
      </ol>
      <p className="mt-2 text-sm text-t-bone-dim" aria-live="polite">
        {phase === "sending" && t("status.live.sending")}
        {phase === "working" && !long && t("status.live.working")}
        {long && t("status.live.long")}
        {phase === "done" && t("status.live.done")}
      </p>
    </div>
  );
}
