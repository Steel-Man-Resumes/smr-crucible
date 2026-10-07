"use client";

/**
 * NextStepCard -- the prominent "your next step" CTA.
 *
 * Presentational: receives the computed next step from JourneyHeader (which owns
 * the single /api/next-step fetch). It is the one place on the page that says
 * what to do now, which step of the six it is, and why. The step list above it
 * (StageProgressBar) shows where that step sits.
 */

import Link from "next/link";
// Deep import: canonical stage vocabulary without dragging the core barrel
// (db/pg) into the client bundle.
import {
  arcStageForNextStep,
  stepPositionLabel,
  whyForNextStep,
} from "@crucible/core/src/journeyStages";

export interface NextStep {
  stage: number;
  action: string;
  href: string;
  reason?: string;
}

export function NextStepCard({ next, why }: { next: NextStep; why?: string | null }) {
  // The tour is stage 0, which is not one of the six steps: call it "Start here".
  const position = stepPositionLabel(next.stage === 0 ? 0 : arcStageForNextStep(next));
  const reasonLine = why || whyForNextStep(next);

  return (
    <Link
      href={next.href}
      className="t-focus block bg-t-amber text-white shadow-[0_3px_8px_rgba(22,26,21,0.15)] p-5 sm:p-6 hover:bg-t-amber-bright transition-colors"
    >
      <p className="font-term text-xs font-semibold uppercase text-white/80">
        Your next step &middot; {position}
      </p>
      <h2 className="text-xl font-bold mt-1 mb-1 !text-white">{next.action}</h2>
      <p className="text-sm text-white/90 leading-relaxed mb-3 max-w-xl">{reasonLine}</p>
      <span className="inline-flex items-center text-sm font-bold text-white">
        Do this step
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="ml-1"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  );
}
