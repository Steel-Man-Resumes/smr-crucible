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
import { TroyLivingIcon } from "./TroyLivingIcon";

interface AssistantDrawerProps {
  /** Content of the assistant conversation */
  children: ReactNode;
  /** Whether the assistant is available (requires core consent) */
  enabled?: boolean;
  /** Optional label for the trigger button */
  triggerLabel?: string;
  /**
   * Draw the user's eye to t.ROY (brighter/faster glow + pop) — set this when he
   * has something timely to say. Independent of the one-time first-visit nudge.
   */
  attention?: boolean;
}

export function AssistantDrawer({
  children,
  enabled = true,
  triggerLabel = "Ask t.ROY",
  attention = false,
}: AssistantDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  // First-visit nudge: t.ROY glows for a few seconds to say "I'm here and alive."
  // Once per browser session, and never while the drawer is open.
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem("troy-nudged") === "1") return;
    } catch {
      // sessionStorage blocked (private mode) — just skip the nudge.
      return;
    }
    const start = window.setTimeout(() => setNudge(true), 3500);
    const stop = window.setTimeout(() => {
      setNudge(false);
      try {
        sessionStorage.setItem("troy-nudged", "1");
      } catch {
        /* ignore */
      }
    }, 3500 + 6000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, []);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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

  // Trap focus in drawer when open: move focus in on open, cycle Tab/Shift+Tab
  // within the panel's focusables, and restore focus to the trigger on close.
  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      drawerRef.current?.focus();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        const panel = drawerRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !panel.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }

    // Closed: return focus to whatever triggered the drawer.
    previouslyFocused.current?.focus();
    previouslyFocused.current = null;
  }, [isOpen]);

  if (!enabled) return null;

  return (
    <>
      {/* Trigger — t.ROY himself, living in the corner. Never auto-opens.
          The figure is the control; the label reveals on hover/focus. */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="t-focus group fixed bottom-24 right-2 z-40 flex min-h-touch items-center gap-1 rounded-full bg-transparent p-1 sm:bottom-5 sm:right-4"
          aria-label={`${triggerLabel} — open assistant`}
        >
          <span className="pointer-events-none hidden rounded-full border border-[#e4d9ff] bg-white/95 px-3 py-1.5 text-sm font-semibold text-[#4c1d95] opacity-0 shadow-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline-block">
            {triggerLabel}
          </span>
          <TroyLivingIcon size={62} attention={attention || nudge} />
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
