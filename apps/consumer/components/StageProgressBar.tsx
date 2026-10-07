"use client";

/**
 * StageProgressBar -- the six plain steps (master plan Section 3).
 *
 * The one progress system on the dashboard. Steps are named in plain words
 * ("Your resume", "Pick a job to aim at", "Tailor it"...). Completed steps are
 * checkmarked and clickable (the person can always go back); the current step
 * is highlighted; later steps are greyed as "coming up", never "locked".
 * On a phone it shows "Step 2 of 6" and the name, with the full list one tap
 * away. Presentational: currentStage comes from the next-step engine via
 * JourneyHeader.
 */

import Link from "next/link";
// Deep import: canonical stage vocabulary without dragging the core barrel
// (db/pg) into the client bundle.
import {
  FORGE_VS_REFINERY_LINE,
  JOURNEY_STAGES,
  JOURNEY_STEP_COUNT,
} from "@crucible/core/src/journeyStages";

const STAGES = JOURNEY_STAGES.filter((s) => s.stage >= 1).map((s) => ({
  n: s.stage,
  label: s.short,
  href: s.href,
}));

function Badge({
  state,
  n,
}: {
  state: "done" | "current" | "upcoming";
  n: number;
}) {
  const cls =
    state === "current"
      ? "bg-[#14100a]/20 text-white"
      : state === "done"
        ? "bg-t-panel-2 text-t-amber-bright border border-t-amber"
        : "bg-t-panel text-t-phos-dim border border-t-line";
  return (
    <span
      className={`flex items-center justify-center w-5 h-5 text-xs flex-shrink-0 ${cls}`}
    >
      {state === "done" ? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 6.5l2.5 2.5 4.5-5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}

export function StageProgressBar({ currentStage }: { currentStage: number }) {
  // The caller maps orientation (stage 0) onto the arc with arcStageForNextStep
  // so "Your resume" is not shown as current once the Forge is done. 7 means the
  // arc is complete.
  const total = JOURNEY_STEP_COUNT;
  const current = Math.min(Math.max(currentStage, 1), total + 1);
  const mobileIdx = Math.min(current, total);
  const mobileLabel = STAGES[mobileIdx - 1]?.label ?? "Keep going";

  function stateOf(n: number): "done" | "current" | "upcoming" {
    return n < current ? "done" : n === current ? "current" : "upcoming";
  }

  return (
    <nav
      aria-label="Your steps"
      className="bg-t-panel border border-t-line p-3 sm:p-4"
    >
      {/* Mobile: where you are, with the whole list one tap away */}
      <details className="sm:hidden group">
        <summary className="t-focus flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-term text-[11px] font-semibold uppercase text-t-bone-dim">
              {current > total ? "All steps done" : `Step ${mobileIdx} of ${total}`}
            </span>
            <span className="block text-sm font-semibold text-t-white">{mobileLabel}</span>
          </span>
          <span className="flex-shrink-0 text-xs font-medium text-t-amber-bright">
            <span className="group-open:hidden">See all steps</span>
            <span className="hidden group-open:inline">Hide steps</span>
          </span>
        </summary>
        <ol className="mt-3 space-y-1.5">
          {STAGES.map((s) => {
            const state = stateOf(s.n);
            return (
              <li
                key={s.n}
                aria-current={state === "current" ? "step" : undefined}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm ${
                  state === "current" ? "bg-t-amber text-white font-semibold" : "text-t-bone-dim"
                }`}
              >
                <Badge state={state} n={s.n} />
                <span>{s.label}</span>
                {state === "done" && <span className="sr-only">(done)</span>}
              </li>
            );
          })}
        </ol>
      </details>

      {/* Desktop: all six at once */}
      <ol className="hidden sm:flex items-stretch gap-1.5">
        {STAGES.map((s) => {
          const state = stateOf(s.n);
          const cls =
            "t-focus h-full flex items-center gap-2 px-3 py-2 text-sm leading-tight transition-colors " +
            (state === "current"
              ? "bg-t-amber text-white font-semibold"
              : state === "done"
                ? "bg-t-panel-2 text-t-bone-dim hover:text-t-amber-bright"
                : "bg-t-bg text-t-bone-dim");
          const content = (
            <>
              <Badge state={state} n={s.n} />
              <span className="min-w-0">{s.label}</span>
              {state === "done" && <span className="sr-only">(done)</span>}
            </>
          );
          return (
            <li key={s.n} className="flex-1 min-w-0">
              {state === "done" ? (
                <Link href={s.href} className={cls}>
                  {content}
                </Link>
              ) : (
                <div className={cls} aria-current={state === "current" ? "step" : undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-xs leading-relaxed text-t-bone-dim">{FORGE_VS_REFINERY_LINE}</p>
    </nav>
  );
}
