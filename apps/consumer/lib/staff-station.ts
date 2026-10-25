/**
 * Staff screens speak the participant's map (CRM wave 2026-10-25, lane C1).
 *
 * The person sees seven stations; staff used to see "Stage N of 6" from the
 * legacy journey vocabulary. This shows the stored stage as the station name
 * through stationForJourneyStage. Display only: no data changes, no third
 * vocabulary.
 */
import { STATIONS, stationForJourneyStage, type StationId } from "./refinery-nav";

export function stationLabelForStage(stage: number | null | undefined): string | null {
  if (stage == null || !Number.isFinite(stage)) return null;
  const id = stationForJourneyStage(stage);
  return STATIONS.find((s) => s.id === id)?.label ?? null;
}

/** Position on the board (0 = Overview), for sorting by where people are. */
export function stationOrderForStage(stage: number | null | undefined): number {
  if (stage == null || !Number.isFinite(stage)) return -1;
  const id: StationId = stationForJourneyStage(stage);
  return STATIONS.findIndex((s) => s.id === id);
}
