"use client";

/**
 * "Leer en español" on a saved resume (lane D1): the connected component the
 * library page renders. It hands everything to SpanishReadingPanel.tsx (switch
 * and language gate, panel, fetch).
 *
 * In English, or with SPANISH_READING_ENABLED off, this renders nothing.
 *
 * There is no "ask for more" here on purpose. The limit is a fixed number of
 * readings per resume version (lib/spanish-reading/handler.ts); the progress
 * bar's AI-bonus request adds regular coaching calls and never raises it, so a
 * button for it would promise something it cannot do (found 2026-11-15).
 */

import { SpanishReadingGate } from "./SpanishReadingPanel";

export function SpanishReading({ artifactId, version }: { artifactId: string; version: string }) {
  return <SpanishReadingGate artifactId={artifactId} version={version} />;
}
