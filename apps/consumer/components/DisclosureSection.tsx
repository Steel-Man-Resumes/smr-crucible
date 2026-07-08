"use client";

import type { ReactNode } from "react";

interface DisclosureSectionProps {
  title: string;
  summary?: string;
  /** Whether the section starts open */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function DisclosureSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: DisclosureSectionProps) {
  return (
    <details open={defaultOpen || undefined} className="group font-term">
      <summary className="cursor-pointer list-none flex items-center gap-2 py-3 select-none">
        <svg
          className="w-4 h-4 text-t-phos-dim transition-transform group-open:rotate-90 flex-shrink-0"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
        <span className="font-semibold text-t-white">{title}</span>
      </summary>
      {summary && (
        <p className="text-sm text-t-phos-dim ml-6 -mt-1 mb-2">{summary}</p>
      )}
      <div className="ml-6 pb-4">{children}</div>
    </details>
  );
}
