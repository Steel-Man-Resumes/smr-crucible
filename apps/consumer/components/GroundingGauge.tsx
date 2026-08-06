"use client";

/**
 * GroundingGauge -- the user-facing honest contract (F2).
 *
 * Shows how much true material we have to work with (RED/AMBER/GREEN) and, plainly,
 * what we will leave blank rather than invent. Deterministic: fed by
 * lib/grounding.ts computeGrounding(). Purely presentational.
 */

import type { GroundingScore } from "@/lib/grounding";

const BAND_STYLE = {
  red: {
    bar: "bg-t-red",
    text: "text-t-red",
    border: "border-t-red",
    tag: "NEEDS MORE",
  },
  amber: {
    bar: "bg-t-amber",
    text: "text-t-amber-bright",
    border: "border-t-amber",
    tag: "GOOD",
  },
  green: {
    bar: "bg-t-phos",
    text: "text-t-phos",
    border: "border-t-phos",
    tag: "STRONG",
  },
} as const;

export function GroundingGauge({ score }: { score: GroundingScore }) {
  const s = BAND_STYLE[score.band];

  return (
    <div className={`bg-t-panel border ${s.border} p-4 mb-4`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase text-t-phos-dim tracking-wide">
          How true-to-you your resume will be
        </span>
        <span className={`text-[10px] font-bold uppercase ${s.text}`}>{s.tag}</span>
      </div>

      {/* Meter */}
      <div className="h-2 bg-t-line overflow-hidden mb-2">
        <div
          className={`h-full ${s.bar} transition-all duration-500`}
          style={{ width: `${Math.max(6, score.percent)}%` }}
        />
      </div>

      <p className={`text-sm font-semibold ${s.text} mb-1`}>{score.headline}</p>
      <p className="text-xs text-t-phos-dim leading-relaxed">{score.detail}</p>

      {score.missing.length > 0 && (
        <div className="mt-3 border-t border-t-line pt-3">
          <p className="text-[11px] font-semibold text-t-white mb-1.5">
            What we&apos;ll leave blank rather than make up:
          </p>
          <ul className="space-y-1">
            {score.missing.map((m, i) => (
              <li key={i} className="text-[11px] text-t-phos-dim flex gap-2">
                <span className="text-t-phos-dim flex-shrink-0">--</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
