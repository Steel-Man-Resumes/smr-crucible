"use client";

/**
 * The Forge progress bar, drawn from the person's own path (lib/forge-path.ts).
 * One segment per screen they will actually see, so a short path shows fewer
 * segments and a screen added later shows up the moment it is added. Names,
 * never numbers or percentages.
 */

import type { ProgressStep } from "@/lib/forge-path";

export function ForgePathProgress({ steps }: { steps: ProgressStep[] }) {
  const current = steps.find((s) => s.state === "current");
  const left = steps.filter((s) => s.state === "todo");
  return (
    <nav aria-label="Your steps" className="w-full" data-testid="forge-path-progress">
      <ol className="flex h-1 w-full gap-[3px]" aria-hidden="true">
        {steps.map((s) => (
          <li
            key={s.id}
            className={`h-full flex-1 transition-colors duration-500 ${
              s.state === "done" ? "bg-t-amber" : s.state === "current" ? "bg-t-amber-bright" : "bg-t-line"
            }`}
          />
        ))}
      </ol>
      <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 py-1.5 font-term text-[11px] text-t-phos-dim sm:px-6">
        <ol className="hidden flex-wrap items-center gap-x-2 sm:flex">
          {steps.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2" aria-current={s.state === "current" ? "step" : undefined}>
              {i > 0 && <span aria-hidden="true">/</span>}
              <span className={s.state === "current" ? "font-semibold text-t-white" : s.state === "done" ? "text-t-phos" : ""}>
                {s.label}
                {s.state === "done" && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="sm:hidden" data-testid="forge-path-progress-phone">
          <span className="font-semibold text-t-white">{current?.label}</span>
          {left.length > 0 && <span>. Then {left.map((s) => s.label).join(", ")}</span>}
        </p>
      </div>
    </nav>
  );
}
