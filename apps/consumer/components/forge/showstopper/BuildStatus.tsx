"use client";

/**
 * What is really happening with the build, and nothing more. /api/analyze
 * does not stream, so the only true steps are: the request went out, it is
 * being worked on (with the real time so far), and it came back. No
 * percentages, no made-up stages.
 */

import { Check } from "lucide-react";
import { elapsedLabel } from "@/lib/showstopper-tour";

export type BuildPhase = "sending" | "working" | "done";

/** Past this many seconds the screen says plainly that it is running long. */
export const LONG_RUN_SECONDS = 90;

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-line border-t-t-amber-bright"
      aria-hidden="true"
    />
  );
}

function Mark({ state }: { state: "done" | "active" | "waiting" }) {
  if (state === "done")
    return (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-t-amber text-ws-bg" aria-hidden="true">
        <Check size={11} strokeWidth={3} />
      </span>
    );
  if (state === "active") return <Spinner />;
  return <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-t-line" aria-hidden="true" />;
}

export function BuildStatus({ phase, elapsed }: { phase: BuildPhase; elapsed: number }) {
  const long = phase === "working" && elapsed >= LONG_RUN_SECONDS;
  const working: "done" | "active" | "waiting" = phase === "done" ? "done" : phase === "working" ? "active" : "waiting";

  return (
    <div className="border border-t-line bg-t-panel px-4 py-3">
      <ol className="flex flex-col gap-2 font-term text-sm sm:flex-row sm:items-center sm:gap-6" aria-label="Build status">
        <li className="flex items-center gap-2 text-t-white">
          <Mark state={phase === "sending" ? "active" : "done"} />
          <span>Sent to t.ROY</span>
        </li>
        <li className={`flex items-center gap-2 ${working === "waiting" ? "text-t-bone-dim" : "text-t-white"}`}>
          <Mark state={working} />
          <span>Working on it</span>
          {phase === "working" && (
            <span role="timer" className="tabular-nums text-t-amber-bright" aria-label={`${Math.floor(elapsed)} seconds so far`}>
              {elapsedLabel(elapsed)}
            </span>
          )}
        </li>
        <li className={`flex items-center gap-2 ${phase === "done" ? "text-t-white" : "text-t-bone-dim"}`}>
          <Mark state={phase === "done" ? "done" : "waiting"} />
          <span>Done</span>
        </li>
      </ol>
      <p className="mt-2 text-sm text-t-bone-dim" aria-live="polite">
        {phase === "sending" && "Sending your answers to t.ROY."}
        {phase === "working" && !long && "Working on it. This usually takes about a minute."}
        {long && "This is taking longer than usual. It's still working, so stay on this page."}
        {phase === "done" && "Done. Opening your results."}
      </p>
    </div>
  );
}
