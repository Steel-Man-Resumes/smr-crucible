"use client";

/**
 * Every line t.ROY changed, as a plain before and after with the reason.
 * Shown instead of the live fix when motion is reduced (open), and kept under
 * the finished page as a recap (closed) after the live fix plays.
 */

import type { MarkupChange } from "@/lib/markup-changes";

export function ChangesList({ changes, open }: { changes: MarkupChange[]; open: boolean }) {
  if (!changes.length) return null;
  return (
    <details open={open} className="mb-3 border border-t-line bg-t-panel" data-testid="changes-list">
      <summary className="t-focus min-h-touch cursor-pointer px-4 py-3 text-sm font-medium text-t-white">
        What t.ROY changed on your page, and why ({changes.length} {changes.length === 1 ? "line" : "lines"})
      </summary>
      <ol className="space-y-3 border-t border-t-line px-4 py-3">
        {changes.map((c, i) => (
          <li key={i} className="text-sm leading-relaxed">
            <p className="text-t-phos-dim">
              <span className="sr-only">Before: </span>
              <del className="decoration-ws-red-bright decoration-2">{c.old}</del>
            </p>
            <p className="text-t-white">
              <span className="sr-only">After: </span>
              <ins className="no-underline">{c.new}</ins>
            </p>
            <p className="mt-0.5 text-xs text-t-amber-bright">
              <span className="sr-only">Why: </span>
              {c.why}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}
