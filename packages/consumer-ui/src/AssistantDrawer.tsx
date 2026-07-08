/**
 * AssistantDrawer — AI assistant available on every page, never auto-opens.
 *
 * Design brief: "Available on every page, never auto-opens."
 * The AI assistant lives in a slide-out drawer triggered by the user.
 * It provides contextual help based on the current page.
 *
 * Behavioral rules (from DESIGN-BRIEF.md Section VI) are enforced
 * at the API level, not in this component.
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";

interface AssistantDrawerProps {
  /** Content of the assistant conversation */
  children: ReactNode;
  /** Whether the assistant is available (requires core consent) */
  enabled?: boolean;
  /** Optional label for the trigger button */
  triggerLabel?: string;
}

export function AssistantDrawer({
  children,
  enabled = true,
  triggerLabel = "Ask t.ROY",
}: AssistantDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // Trap focus in drawer when open
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  if (!enabled) return null;

  return (
    <>
      {/* Trigger button — fixed bottom-right, never auto-opens */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="t-focus fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2 px-5 py-3 bg-t-amber text-[#14100a] font-term text-sm font-bold shadow-[3px_3px_0_#000] hover:bg-t-amber-bright transition-colors min-h-touch"
          aria-label="Open assistant"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 2C5.58 2 2 5.13 2 9c0 2.38 1.19 4.47 3 5.74V18l3.14-1.74C8.72 16.42 9.34 16.5 10 16.5c4.42 0 8-3.13 8-7S14.42 2 10 2z"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
          {triggerLabel}
        </button>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-label="AI Assistant"
        aria-modal="true"
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-t-panel border-l border-t-line shadow-2xl z-50 flex flex-col font-term transform transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-line bg-t-panel">
          <h2 className="text-base font-bold text-t-white">
            <span className="text-t-phos-dim">{"> "}</span>how can I help?
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="t-focus p-2 text-t-phos-dim hover:text-t-amber-bright transition-colors min-h-touch min-w-[3rem] flex items-center justify-center"
            aria-label="Close assistant"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M15 5L5 15M5 5L15 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Drawer content — min-h-0 breaks flexbox default so overflow works */}
        <div className="flex-1 min-h-0 p-5 flex flex-col">{children}</div>
      </div>
    </>
  );
}
