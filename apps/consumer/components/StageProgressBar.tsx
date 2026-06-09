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
      ? "bg-white/20 text-white"
      : state === "done"
        ? "bg-sage-200 text-sage-700"
        : "bg-gray-100 text-gray-400";
  return (
    <span
      className={`flex items-center justify-center w-5 h-5 rounded-full text-xs flex-shrink-0 ${cls}`}
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
      className="bg-white rounded-2xl border border-border p-3 sm:p-4"
    >
      {/* Mobile: compact step indicator */}
      <div className="sm:hidden flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {current > 6 ? "Journey complete" : `Step ${mobileIdx} of 6`}
        </span>
        <span className="text-sm text-sage-600 font-medium">{mobileLabel}</span>
      </div>

      {/* Desktop: full arc */}
      <ol className="hidden sm:flex items-stretch gap-1.5">
        {STAGES.map((s) => {
          const state: "done" | "current" | "upcoming" =
            s.n < current ? "done" : s.n === current ? "current" : "upcoming";
          const cls =
            "flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors " +
            (state === "current"
              ? "bg-sage-600 text-white font-semibold"
              : state === "done"
                ? "bg-sage-50 text-sage-700 hover:bg-sage-100"
                : "bg-gray-50 text-muted");
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
