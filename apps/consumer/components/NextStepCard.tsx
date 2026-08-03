"use client";

/**
 * NextStepCard -- the prominent "your next step" CTA.
 *
 * Presentational: receives the computed next step from JourneyHeader (which owns
 * the single /api/next-step fetch). This is the focal action of the seven-stage
 * journey; the stage progress bar sits above it.
 */

import Link from "next/link";
// Deep import: canonical stage vocabulary without dragging the core barrel
// (db/pg) into the client bundle.
import { stageNextStepLabel } from "@crucible/core/src/journeyStages";

export interface NextStep {
  stage: number;
  action: string;
  href: string;
  reason?: string;
}

export function NextStepCard({ next }: { next: NextStep }) {
  const stageLabel = stageNextStepLabel(next.stage);

  return (
    <Link
      href={next.href}
      className="t-focus block bg-t-amber text-white shadow-[0_3px_8px_rgba(22,26,21,0.15)] p-6 hover:bg-t-amber-bright transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-white/70">
          Your next step
        </p>
        <span className="text-xs font-medium text-white/70">{stageLabel}</span>
      </div>
      <h2 className="text-xl font-bold mt-1 mb-2">{next.action}</h2>
      <span className="inline-flex items-center text-sm font-bold text-white">
        Continue
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
