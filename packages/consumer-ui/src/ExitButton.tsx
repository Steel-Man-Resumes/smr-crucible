/**
 * ExitButton — Always visible, persistent across all pages.
 *
 * Design brief principle 10: "Exit always available"
 * "Leave this page" button visible on every screen.
 * Fixed position, top-right, accessible.
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { X } from "lucide-react";

interface ExitButtonProps {
  /** Where to go when exiting. Defaults to "/" */
  href?: string;
  /** Optional custom label */
  label?: string;
}

export function ExitButton({
  href = "/",
  label = "Leave this page",
}: ExitButtonProps) {
  return (
    <div className="fixed top-4 right-4 z-50">
      <a
        href={href}
        className="t-focus inline-flex min-h-[3rem] items-center gap-2 rounded-[5px] border border-t-line bg-t-panel/95 px-4 py-2 text-sm font-medium text-t-bone-dim shadow-[0_3px_10px_rgba(22,26,21,0.1)] transition-colors hover:border-t-line-strong hover:text-t-white"
        aria-label={label}
      >
        <X size={17} aria-hidden="true" />
        {label}
      </a>
    </div>
  );
}
