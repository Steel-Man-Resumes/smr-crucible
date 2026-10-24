"use client";

/**
 * Mobile only: a slim strip of the seven stations along the bottom edge. The
 * current station is lit and named; tapping a station opens the board with
 * that station expanded. Decorative line, real buttons.
 */
import { STATIONS, stationStatus, stripCurrentStation, type StationId } from "@/lib/refinery-nav";
import type { ProgressStep, ProgressStepId } from "@/lib/progression-ui";

export function StationStrip({ pathname, steps, currentStepId, onOpen, expanded }: {
  pathname: string;
  steps: readonly ProgressStep[] | null;
  currentStepId: ProgressStepId | null;
  onOpen: (station: StationId) => void;
  expanded: boolean;
}) {
  const current = stripCurrentStation(pathname, currentStepId);
  return (
    <nav aria-label="Your path, quick view" className="board-strip forge-workshop md:hidden">
      <ol>
        {STATIONS.map((station, index) => {
          const status = stationStatus(station, steps, currentStepId);
          const isCurrent = station.id === current;
          return (
            <li key={station.id} data-tone={status.tone}>
              <button type="button" className="t-focus" data-strip-station={station.id} onClick={() => onOpen(station.id)}
                aria-current={isCurrent ? "location" : undefined}
                aria-expanded={expanded}
                aria-controls="refinery-mobile-navigation"
                aria-label={`Station ${index + 1}, ${station.label}${status.step ? `, ${status.tone === "completed" ? "completed" : status.tone === "locked" ? "locked" : status.tone === "early" ? "early access" : status.tone === "current" ? "recommended now" : "available"}` : ""}. Open the path here.`}>
                <span className="strip-dot" aria-hidden="true" />
                {isCurrent ? <span className="strip-label" aria-hidden="true">{station.short}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
