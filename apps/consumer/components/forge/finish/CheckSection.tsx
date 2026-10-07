"use client";

/** One collapsed check on the finish page: a plain one-line summary, details on tap. */

import type { ReactNode } from "react";

export function CheckSection({
  title,
  summary,
  attention = false,
  defaultOpen = false,
  children,
  testId,
}: {
  title: string;
  summary: string;
  /** Draws the eye when the summary says something is open. */
  attention?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details
      className={`group border bg-t-panel ${attention ? "border-t-amber" : "border-t-line"}`}
      open={defaultOpen || undefined}
      data-testid={testId}
    >
      <summary className="t-focus flex min-h-touch cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-t-white">{title}</span>
          <span className={`block text-xs leading-relaxed ${attention ? "text-t-amber-bright" : "text-t-phos-dim"}`}>{summary}</span>
        </span>
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-[11px] text-t-phos-dim">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="border-t border-t-line px-4 py-3">{children}</div>
    </details>
  );
}
