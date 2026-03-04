/**
 * GhostGuide — Inline contextual guidance panel.
 *
 * Always-visible hint on Forge pages. NOT the drawer — this is
 * a small, collapsible panel with a short contextual message
 * from The Ghost. "Ask me more" opens the AssistantDrawer.
 *
 * Accessibility: role="status" + aria-live="polite" so screen
 * readers announce the guidance without interrupting.
 */

"use client";

import { useState, useEffect } from "react";

interface GhostGuideProps {
  /** The contextual hint (1-2 sentences max) */
  message: string;
  /** Label for the expand link */
  expandLabel?: string;
  /** Opens the AssistantDrawer */
  onExpand?: () => void;
  /** Unique page ID for collapse persistence */
  pageId: string;
}

function getCollapseKey(pageId: string) {
  return `ghost_guide_collapsed_${pageId}`;
}

export function GhostGuide({
  message,
  expandLabel = "Ask me more",
  onExpand,
  pageId,
}: GhostGuideProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Load collapse state from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getCollapseKey(pageId));
      if (stored === "true") setCollapsed(true);
    } catch {
      // localStorage may be unavailable
    }
  }, [pageId]);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(getCollapseKey(pageId), String(next));
    } catch {
      // fail silently
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-sage-50 rounded-xl border border-sage-200 mb-6"
    >
      {collapsed ? (
        <button
          onClick={toggleCollapse}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm text-sage-600 hover:text-sage-700 transition-colors"
          aria-label="Show guidance from t.ROY"
        >
          {/* Ghost icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="flex-shrink-0"
          >
            <path
              d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
          <span>Show t.ROY guidance</span>
        </button>
      ) : (
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            {/* Ghost avatar */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="flex-shrink-0 mt-0.5 text-sage-500"
            >
              <path
                d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-sage-700 leading-relaxed">{message}</p>

              <div className="flex items-center gap-3 mt-2">
                {onExpand && (
                  <button
                    onClick={onExpand}
                    className="text-xs text-sage-600 underline underline-offset-2 hover:text-sage-700 transition-colors"
                  >
                    {expandLabel}
                  </button>
                )}
                <button
                  onClick={toggleCollapse}
                  className="text-xs text-sage-500 hover:text-sage-600 transition-colors"
                  aria-label="Hide guidance"
                >
                  Hide
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
