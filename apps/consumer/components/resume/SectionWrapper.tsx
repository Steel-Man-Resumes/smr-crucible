"use client";

import { useState, type ReactNode } from "react";
import type { SectionScore } from "./resumeModel";

interface Props {
  score: SectionScore;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function SectionWrapper({ score, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const icon =
    score.status === "complete"
      ? "check"
      : score.status === "partial"
        ? "partial"
        : "empty";

  return (
    <div className="border border-t-line overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="t-focus w-full flex items-center gap-3 px-4 py-3 bg-t-panel hover:bg-t-panel-2 transition-colors text-left min-h-touch"
      >
        {/* Status icon */}
        <span className="flex-shrink-0">
          {icon === "check" ? (
            <span className="w-5 h-5 border border-t-amber text-t-amber-bright flex items-center justify-center text-xs font-bold">
              &#10003;
            </span>
          ) : icon === "partial" ? (
            <span className="w-5 h-5 border border-t-phos-dim text-t-phos-dim flex items-center justify-center text-[10px] font-bold">
              &#9679;
            </span>
          ) : (
            <span className="w-5 h-5 border border-t-line text-t-line flex items-center justify-center text-[10px]">
              &#9675;
            </span>
          )}
        </span>

        <span className="flex-1 text-sm font-medium text-t-white">
          {score.label}
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-t-phos-dim transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-t-line bg-t-panel">
          {/* Coaching tip */}
          {score.tip && (
            <p className="text-xs text-t-amber-bright mb-3 leading-relaxed">
              {score.tip}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
