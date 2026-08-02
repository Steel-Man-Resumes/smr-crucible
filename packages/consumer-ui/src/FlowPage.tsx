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
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { TYPOGRAPHY } from "./theme";
import { TBtn } from "./terminal";

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
    <div className="flex min-h-[calc(100vh-76px)] flex-col bg-t-bg font-body">
      {/* Back navigation */}
      {showBack && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
          <button
            onClick={onBack}
            className="t-focus inline-flex min-h-touch items-center gap-1 rounded-[4px] px-2 text-sm font-medium text-t-bone-dim transition-colors hover:text-t-amber-bright"
            aria-label="Go back"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            Back
          </button>
        </div>
      )}

      {/* Main content area — centered, constrained */}
      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:justify-center sm:px-6 sm:py-12">
        <div className="w-full max-w-flow">
          {/* Title */}
          <h1 className="mb-3 text-3xl font-semibold leading-tight text-t-white">{title}</h1>

          {/* Subtitle */}
          {subtitle && (
            <p className="mb-8 text-base leading-relaxed text-t-bone-dim">{subtitle}</p>
          )}

          {/* Interactive content */}
          <div className="mb-8">{children}</div>

          {/* Primary action */}
          {actionLabel && (
            <TBtn
              onClick={onAction}
              disabled={actionDisabled || loading}
              className="w-full sm:w-auto sm:min-w-48"
            >
              {loading ? "Working" : actionLabel}
            </TBtn>
          )}
        </div>
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-4 pb-6 text-center">
          <div className="text-sm text-t-bone-dim max-w-flow mx-auto">{footer}</div>
        </div>
      )}
    </div>
  );
}
