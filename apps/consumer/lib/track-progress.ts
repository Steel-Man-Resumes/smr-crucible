/**
 * trackProgress -- Phase 1D dual-write client helper.
 *
 * Fires a fire-and-forget POST to /api/activity alongside the existing
 * localStorage "consumer_progress" writes at each tool's write site. Never
 * throws, never blocks the UI -- a failed ping just means the server ledger
 * missed one event; localStorage still has it until Phase 4.2 retires that
 * store. Not imported into a server component; this hits fetch() directly.
 */

import type { ProgressEventType } from "@crucible/core";

export function trackProgress(type: ProgressEventType, context?: Record<string, unknown>): void {
  try {
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, context: context ?? {} }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Silent -- localStorage already has this event.
  }
}
