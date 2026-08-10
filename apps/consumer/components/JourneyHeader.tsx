"use client";

/**
 * JourneyHeader -- the top of the Refinery dashboard for the seven-stage journey.
 *
 * Owns the single /api/next-step fetch and renders the stage progress bar plus
 * the next-step card from one round trip. Renders nothing until loaded and
 * nothing on error -- it never blocks the dashboard.
 */

import { useState, useEffect } from "react";
import { NextStepCard, type NextStep } from "@/components/NextStepCard";
import { StageProgressBar } from "@/components/StageProgressBar";

export function JourneyHeader() {
  const [next, setNext] = useState<NextStep | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 4.4: the AI-phrased (or deterministic-fallback) WHY for this step.
  const [why, setWhy] = useState<string | null>(null);

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

  // Fetch the WHY only once the card is actually going to render (next is set),
  // keeping it optional + cheap. On any failure the endpoint already returns the
  // deterministic why; if the whole call fails we simply show no why line.
  useEffect(() => {
    if (!next) return;
    let cancelled = false;
    fetch("/api/next-step-why", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.why) setWhy(j.why as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [next]);

  if (loading || !next) return null;

  return (
    <div className="space-y-4">
      <StageProgressBar currentStage={next.stage} />
      <NextStepCard next={next} />
      {why && (
        <details className="group -mt-1 px-1">
          <summary className="t-focus inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-t-phos-dim hover:text-t-white">
            <span>Why this step?</span>
            <span className="transition-transform group-open:rotate-90" aria-hidden="true">
              &rsaquo;
            </span>
          </summary>
          <p className="mt-2 max-w-2xl text-sm text-t-phos-dim leading-relaxed">{why}</p>
        </details>
      )}
    </div>
  );
}
