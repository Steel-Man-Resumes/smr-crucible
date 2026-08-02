"use client";

/**
 * ContactTroyButton — Engagement-gated contact button.
 *
 * Floats in the bottom-left corner (opposite the AssistantDrawer trigger).
 * Only activates after the user has meaningfully engaged:
 * - Visited 3+ Forge pages, OR
 * - Completed the Forge flow (has forgeOutput), OR
 * - Is authenticated (dashboard user)
 *
 * Before gate is met: button is dimmed with a "try the tool first" message.
 * After gate: opens mailto link.
 *
 * Contact email configurable via NEXT_PUBLIC_CONTACT_EMAIL env var.
 */

import { useState } from "react";
import { Mail } from "lucide-react";

const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL || "troy@steelmanresumes.com";

interface ContactTroyButtonProps {
  /** Number of Forge pages visited */
  pagesVisited?: number;
  /** Whether user has completed the Forge flow */
  hasForgeOutput?: boolean;
  /** Whether user is authenticated (always unlocked in dashboard) */
  isAuthenticated?: boolean;
}

export function ContactTroyButton({
  pagesVisited = 0,
  hasForgeOutput = false,
  isAuthenticated = false,
}: ContactTroyButtonProps) {
  const [showGateMessage, setShowGateMessage] = useState(false);

  const isUnlocked =
    isAuthenticated || hasForgeOutput || pagesVisited >= 3;

  function handleClick() {
    if (isUnlocked) {
      window.location.href = `mailto:${CONTACT_EMAIL}`;
    } else {
      setShowGateMessage(true);
      setTimeout(() => setShowGateMessage(false), 4000);
    }
  }

  return (
    <div className="fixed bottom-24 left-4 sm:bottom-6 sm:left-6 z-40">
      {/* Gate message tooltip */}
      {showGateMessage && (
        <div className="absolute bottom-full left-0 mb-2 w-64 rounded-[6px] border border-border bg-white p-3 shadow-lg animate-fadeIn">
          <p className="text-sm text-foreground leading-relaxed">
            Try the tool first — I built it for you. If you still need me
            after, I&apos;m right here.
          </p>
        </div>
      )}

      <button
        onClick={handleClick}
        className={`inline-flex min-h-touch items-center gap-2 rounded-[6px] border px-4 py-3 text-sm font-medium shadow-[0_6px_18px_rgba(22,26,21,0.16)] transition-colors ${
          isUnlocked
            ? "border-[#3d5745] bg-[#4f6b57] text-white hover:bg-[#3d5745]"
            : "cursor-default border-t-line bg-t-panel-2 text-t-bone-dim"
        }`}
        aria-label={
          isUnlocked
            ? "Contact Troy via email"
            : "Contact Troy — complete more of the tool first"
        }
      >
        <Mail size={18} aria-hidden="true" />
        <span className="hidden sm:inline">Contact Troy</span>
      </button>
    </div>
  );
}
