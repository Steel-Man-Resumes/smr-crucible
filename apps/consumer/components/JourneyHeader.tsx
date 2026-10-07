"use client";

/**
 * JourneyHeader -- the top of the Refinery dashboard: the six plain steps plus the next step.
 *
 * Owns the single /api/next-step fetch and renders the stage progress bar plus
 * the next-step card from one round trip. Renders nothing until loaded and
 * nothing on error -- it never blocks the dashboard.
 */

import { useState, useEffect } from "react";
import { NextStepCard, type NextStep } from "@/components/NextStepCard";
import { StageProgressBar } from "@/components/StageProgressBar";
import { NEXT_STEP_CHANGED_EVENT } from "@/lib/guidedTour";
import { arcStageForNextStep, whyForNextStep } from "@crucible/core/src/journeyStages";

export function JourneyHeader() {
  const [next, setNext] = useState<NextStep | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 4.4: the AI-phrased (or deterministic-fallback) WHY for this step.
  const [why, setWhy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      // no-store: after the tour is completed or deferred the server has just
      // invalidated its cache, so never serve this from the browser cache.
      fetch("/api/next-step", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j?.data) setNext(j.data as NextStep);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    // The guided tour announces when it is completed or deferred; refetch so the
    // card stops showing the tour step without a full reload.
    window.addEventListener(NEXT_STEP_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(NEXT_STEP_CHANGED_EVENT, load);
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

  // The card always carries the plain reason. The AI-phrased line, when it
  // arrives and says something different, sits under "More on this step".
  const plainWhy = whyForNextStep(next);
  const extraWhy = why && why.trim() !== plainWhy ? why : null;

  return (
    <div className="space-y-3">
      <StageProgressBar currentStage={arcStageForNextStep(next)} />
      <NextStepCard next={next} why={plainWhy} />
      {extraWhy && (
        <details className="group px-1">
          <summary className="t-focus inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-t-bone-dim hover:text-t-white">
            <span>More on this step</span>
            <span className="transition-transform group-open:rotate-90" aria-hidden="true">
              &rsaquo;
            </span>
          </summary>
          <p className="mt-2 max-w-2xl text-sm text-t-bone-dim leading-relaxed">{extraWhy}</p>
        </details>
      )}
    </div>
  );
}
