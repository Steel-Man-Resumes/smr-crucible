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
    <div className="fixed bottom-6 left-6 z-40">
      {/* Gate message tooltip */}
      {showGateMessage && (
        <div className="absolute bottom-full left-0 mb-2 w-64 p-3 bg-white rounded-xl shadow-lg border border-border animate-fadeIn">
          <p className="text-sm text-foreground leading-relaxed">
            Try the tool first — I built it for you. If you still need me
            after, I&apos;m right here.
          </p>
        </div>
      )}

      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-colors min-h-touch text-sm font-medium ${
          isUnlocked
            ? "bg-earth-600 text-white hover:bg-earth-700"
            : "bg-earth-200 text-earth-500 cursor-default"
        }`}
        aria-label={
          isUnlocked
            ? "Contact Troy via email"
            : "Contact Troy — complete more of the tool first"
        }
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="2"
            y="4"
            width="14"
            height="10"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M2 6l7 4 7-4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Contact Troy
      </button>
    </div>
  );
}
