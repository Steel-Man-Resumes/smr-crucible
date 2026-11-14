/**
 * ProgressIndicator — Minimal, non-anxiety-inducing.
 *
 * Design brief: No "step 4 of 11" — that creates anxiety.
 * Instead, a subtle visual indicator that shows general progress
 * without numbers or percentages.
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { useTranslations } from "next-intl";

interface ProgressIndicatorProps {
  /** Current step (0-indexed) */
  current: number;
  /** Total steps */
  total: number;
}

export function ProgressIndicator({ current, total }: ProgressIndicatorProps) {
  const t = useTranslations("ui.progressIndicator");
  const percentage = Math.min(100, Math.round(((current + 1) / total) * 100));

  return (
    <div className="w-full" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} aria-label={t("label")}>
      <div className="h-1 w-full overflow-hidden bg-t-line">
        <div
          className="h-full bg-t-amber transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
