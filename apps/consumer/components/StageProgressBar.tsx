"use client";

/**
 * StageProgressBar -- the seven-stage journey arc (master plan Section 3).
 *
 * Emotional tone matters: completed stages are checkmarked and clickable (the
 * user can always go back); the current stage is highlighted; upcoming stages
 * are greyed as "coming up" -- never "locked." Presentational: currentStage
 * comes from the next-step engine via JourneyHeader.
 */

import Link from "next/link";

const STAGES = [
  { n: 1, label: "Foundation", href: "/intro" },
  { n: 2, label: "Target", href: "/dashboard/jobs" },
  { n: 3, label: "Materials", href: "/dashboard/application-tailor" },
  { n: 4, label: "Approach", href: "/dashboard/disclosure" },
  { n: 5, label: "Practice", href: "/dashboard/interview" },
  { n: 6, label: "Apply", href: "/dashboard/applications" },
];

function Badge({
  state,
  n,
}: {
  state: "done" | "current" | "upcoming";
  n: number;
}) {
  const cls =
    state === "current"
      ? "bg-[#14100a]/20 text-[#14100a]"
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
  // Orientation (0) shows Foundation as current; 7 means the arc is complete.
  const current = Math.min(Math.max(currentStage, 1), 7);
  const mobileIdx = Math.min(current, 6);
  const mobileLabel = STAGES[mobileIdx - 1]?.label ?? "Keep going";

  return (
    <nav
      aria-label="Your journey"
      className="bg-t-panel border border-t-line p-3 sm:p-4 font-term"
    >
      {/* Mobile: compact step indicator */}
      <div className="sm:hidden flex items-center justify-between">
        <span className="text-sm font-semibold text-t-white">
          {current > 6 ? "Journey complete" : `Step ${mobileIdx} of 6`}
        </span>
        <span className="text-sm text-t-amber-bright font-medium">{mobileLabel}</span>
      </div>

      {/* Desktop: full arc */}
      <ol className="hidden sm:flex items-stretch gap-1.5">
        {STAGES.map((s) => {
          const state: "done" | "current" | "upcoming" =
            s.n < current ? "done" : s.n === current ? "current" : "upcoming";
          const cls =
            "t-focus flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-sm transition-colors " +
            (state === "current"
              ? "bg-t-amber text-[#14100a] font-semibold"
              : state === "done"
                ? "bg-t-panel-2 text-t-bone-dim hover:text-t-amber-bright"
                : "bg-t-bg text-t-bone-dim");
          const content = (
            <>
              <Badge state={state} n={s.n} />
              <span className="truncate">{s.label}</span>
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
    </nav>
  );
}
