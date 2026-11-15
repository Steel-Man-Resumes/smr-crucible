"use client";

/**
 * Mobile only: a slim strip of the seven stations along the bottom edge. The
 * current station is lit and named; tapping a station opens the board with
 * that station expanded. Decorative line, real buttons.
 */
import { useTranslations } from "next-intl";
import { STATIONS, stationStatus, stripCurrentStation, type StationId } from "@/lib/refinery-nav";
import type { ProgressStep, ProgressStepId } from "@/lib/progression-ui";

export function StationStrip({ pathname, steps, currentStepId, onOpen, expanded }: {
  pathname: string;
  steps: readonly ProgressStep[] | null;
  currentStepId: ProgressStepId | null;
  onOpen: (station: StationId) => void;
  expanded: boolean;
}) {
  const t = useTranslations("refineryShell.nav");
  const current = stripCurrentStation(pathname, currentStepId);
  const word = (english: string): string => {
    const key = `labels.${english.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
    return t.has(key) ? t(key) : english;
  };
  return (
    <nav aria-label={t("quickView")} className="board-strip forge-workshop md:hidden">
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
                aria-label={status.step
                  ? t("stationAriaWithStatus", { n: index + 1, label: word(station.label), status: t(`stripStatus.${status.tone === "completed" ? "completed" : status.tone === "locked" ? "locked" : status.tone === "early" ? "early" : status.tone === "current" ? "current" : "available"}`) })
                  : t("stationAria", { n: index + 1, label: word(station.label) })}>
                <span className="strip-dot" aria-hidden="true" />
                {isCurrent ? <span className="strip-label" aria-hidden="true">{word(station.short)}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
