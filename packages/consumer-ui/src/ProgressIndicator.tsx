/**
 * ProgressIndicator — Minimal, non-anxiety-inducing.
 *
 * Design brief: No "step 4 of 11" — that creates anxiety.
 * Instead, a subtle visual indicator that shows general progress
 * without numbers or percentages.
 */

interface ProgressIndicatorProps {
  /** Current step (0-indexed) */
  current: number;
  /** Total steps */
  total: number;
}

export function ProgressIndicator({ current, total }: ProgressIndicatorProps) {
  const percentage = Math.min(100, Math.round(((current + 1) / total) * 100));

  return (
    <div className="w-full px-4 pt-4" role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
      <div className="h-1 w-full bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-sage-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
