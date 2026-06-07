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

  return (
    <div className="space-y-4">
      <StageProgressBar currentStage={next.stage} />
      <NextStepCard next={next} />
    </div>
  );
}
