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
import { X } from "lucide-react";

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
          className="t-focus fixed bottom-24 right-4 z-40 inline-flex min-h-touch items-center gap-2 rounded-[6px] border border-[#292c27] bg-[#1c1e1b] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(22,26,21,0.22)] transition-colors hover:bg-[#2b2e2a] sm:bottom-6 sm:right-6"
          aria-label="Open assistant"
        >
          <img
            src="/images/t-roy-icon-badge.webp"
            alt=""
            aria-hidden="true"
            className="w-5 h-5 rounded-full flex-shrink-0"
          />
          <span className="hidden sm:inline">{triggerLabel}</span>
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
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md transform flex-col border-l border-t-line bg-t-panel font-body shadow-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-line bg-t-panel">
          <h2 className="text-base font-semibold text-t-white">
            How can I help?
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="t-focus flex min-h-touch min-w-[3rem] items-center justify-center rounded-[4px] p-2 text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            aria-label="Close assistant"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Drawer content — min-h-0 breaks flexbox default so overflow works */}
        <div className="flex-1 min-h-0 p-5 flex flex-col">{children}</div>
      </div>
    </>
  );
}
