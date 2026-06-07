"use client";

/**
 * NextStepCard -- the prominent "your next step" CTA on the dashboard.
 *
 * Fetches /api/next-step (deterministic computeNextStep over the user's real
 * profile). Renders nothing until loaded, and nothing on error -- it never
 * blocks the dashboard. This is the first surface of the seven-stage journey
 * engine; the full stage progress bar layers on top of the same data.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

interface NextStep {
  stage: number;
  action: string;
  href: string;
  reason?: string;
}

const STAGE_LABELS: Record<number, string> = {
  0: "Get oriented",
  1: "Build your foundation",
  2: "Know your target",
  3: "Prepare your materials",
  4: "Plan your approach",
  5: "Practice",
  6: "Apply and track",
  7: "Keep going",
};

export function NextStepCard() {
  const [next, setNext] = useState<NextStep | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/next-step")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) setNext(j.data as NextStep);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !next) return null;

  const stageLabel = STAGE_LABELS[next.stage] ?? `Stage ${next.stage}`;

  return (
    <Link
      href={next.href}
      className="block bg-sage-600 text-white rounded-2xl p-6 hover:bg-sage-700 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-sage-100">
          Your next step
        </p>
        <span className="text-xs font-medium text-sage-100/80">{stageLabel}</span>
      </div>
      <h2 className="text-xl font-bold mt-1 mb-2">{next.action}</h2>
      <span className="inline-flex items-center text-sm font-medium text-white">
        Continue
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="ml-1"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  );
}
