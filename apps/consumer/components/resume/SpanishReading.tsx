"use client";

/**
 * "Leer en español" on a saved resume (lane D1): the connected component the
 * library page renders. It adds the one thing the panel cannot import in a
 * test, the progress bar's request for more AI actions, and hands the rest to
 * SpanishReadingPanel.tsx (switch and language gate, panel, fetch).
 *
 * In English, or with SPANISH_READING_ENABLED off, this renders nothing.
 */

import { useProgression } from "@/components/progression/ProgressionProvider";
import { progressionAllowanceDisplay } from "@/lib/progression-ui";
import { SpanishReadingGate } from "./SpanishReadingPanel";

export function SpanishReading({ artifactId, version }: { artifactId: string; version: string }) {
  const progress = useProgression();
  const step = progress?.data?.steps.find((s) => s.id === progress.data!.currentStepId);
  const canAsk = !!progress?.data && !!step && progressionAllowanceDisplay(progress.data.allowance).canAsk;
  // The existing request path (kind ai_bonus); the server policy decides any amount.
  const askMore = canAsk && step ? () => progress!.ask(step, "ai_bonus") : undefined;
  return <SpanishReadingGate artifactId={artifactId} version={version} askMore={askMore} />;
}
