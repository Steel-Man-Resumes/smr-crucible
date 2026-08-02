/**
 * GhostGuide — Inline contextual guidance panel.
 *
 * Always-visible hint on Forge pages. NOT the drawer — this is
 * a small, collapsible panel with a short contextual message
 * from t.ROY. "Ask me more" opens the AssistantDrawer.
 *
 * Accessibility: role="status" + aria-live="polite" so screen
 * readers announce the guidance without interrupting.
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
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
      className="mb-6 overflow-hidden rounded-[6px] border border-t-line border-l-[3px] border-l-[#4f6b57] bg-t-panel shadow-[0_2px_8px_rgba(22,26,21,0.04)]"
    >
      {collapsed ? (
        <button
          onClick={toggleCollapse}
          className="t-focus flex w-full items-center gap-2 px-4 py-3 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
          aria-label="Show guidance from t.ROY"
        >
          {/* t.ROY icon */}
          <img
            src="/images/t-roy-icon-badge.webp"
            alt=""
            aria-hidden="true"
            className="w-4 h-4 rounded-full flex-shrink-0"
          />
          <span>Show t.ROY guidance</span>
        </button>
      ) : (
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            {/* t.ROY avatar */}
            <img
              src="/images/t-roy-icon-badge.webp"
              alt="t.ROY"
              className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
            />

            <div className="flex-1 min-w-0">
              <p className="text-sm leading-relaxed text-t-white">{message}</p>

              <div className="flex items-center gap-3 mt-2">
                {onExpand && (
                  <button
                    onClick={onExpand}
                    className="t-focus min-h-0 text-xs font-semibold text-t-amber-bright underline underline-offset-2 transition-colors hover:text-t-amber"
                  >
                    {expandLabel}
                  </button>
                )}
                <button
                  onClick={toggleCollapse}
                  className="t-focus min-h-0 text-xs text-t-bone-dim transition-colors hover:text-t-white"
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
