/**
 * FlowPage — One-question-per-screen pattern.
 *
 * Design brief constraints:
 * - Max 50 words of display text
 * - One primary action per page
 * - Large touch targets (48px min)
 * - Clear visual hierarchy
 * - Always has back navigation (except page 0)
 *
 * This is the core layout primitive for both Forge and Refinery flows.
 */

"use client";

import type { ReactNode } from "react";
import { TYPOGRAPHY } from "./theme";

interface FlowPageProps {
  /** The main question or prompt for this page */
  title: string;
  /** Optional supporting text (keep short — 6th grade reading level) */
  subtitle?: string;
  /** The input/interaction area */
  children: ReactNode;
  /** Primary action button text */
  actionLabel?: string;
  /** Primary action handler */
  onAction?: () => void;
  /** Whether primary action is disabled */
  actionDisabled?: boolean;
  /** Show back button */
  showBack?: boolean;
  /** Back button handler */
  onBack?: () => void;
  /** Optional footer content (privacy notice, etc.) */
  footer?: ReactNode;
  /** Loading state for the action button */
  loading?: boolean;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function FlowPage({
  title,
  subtitle,
  children,
  actionLabel,
  onAction,
  actionDisabled,
  showBack,
  onBack,
  footer,
  loading,
}: FlowPageProps) {
  // Enforce max 50 words display text in development
  if (process.env.NODE_ENV === "development") {
    const totalWords =
      countWords(title) + (subtitle ? countWords(subtitle) : 0);
    if (totalWords > TYPOGRAPHY.maxWordsPerScreen) {
      console.warn(
        `FlowPage: Display text exceeds ${TYPOGRAPHY.maxWordsPerScreen} word limit (${totalWords} words). ` +
          "Design brief requires 6th grade reading level with max 50 words."
      );
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Back navigation */}
      {showBack && (
        <div className="px-4 pt-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors min-h-touch px-2"
            aria-label="Go back"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </button>
        </div>
      )}

      {/* Main content area — centered, constrained */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-flow">
          {/* Title */}
          <h1 className="text-2xl font-bold text-foreground mb-3">{title}</h1>

          {/* Subtitle */}
          {subtitle && (
            <p className="text-body text-muted mb-8">{subtitle}</p>
          )}

          {/* Interactive content */}
          <div className="mb-8">{children}</div>

          {/* Primary action */}
          {actionLabel && (
            <button
              onClick={onAction}
              disabled={actionDisabled || loading}
              className="w-full flex items-center justify-center px-6 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="opacity-25"
                    />
                    <path
                      d="M4 12a8 8 0 018-8"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="opacity-75"
                    />
                  </svg>
                  Working...
                </span>
              ) : (
                actionLabel
              )}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-4 pb-6 text-center">
          <div className="text-sm text-muted max-w-flow mx-auto">{footer}</div>
        </div>
      )}
    </div>
  );
}
