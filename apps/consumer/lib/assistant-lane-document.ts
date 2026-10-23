/** A read-only projection of the selected lane's visible document, never its private record. */
import type { CareerLane } from "@crucible/core/src/careerLaneShared";
import { isCvType } from "@crucible/core/src/careerLaneShared";
import { cleanEntryText, type PracticeEntry } from "@crucible/core/src/practiceRecordShared";
import { withCommonWords } from "@crucible/core/src/facilityDictionary";
import { readKindSettings, buildArtistResumeModel, artistResumePlainText } from "@crucible/core/src/creativeLaneShared";
import { buildCvModel, cvPlainText } from "@crucible/core/src/cvShared";
import { buildPerformerModel, performerPlainText } from "@crucible/core/src/performerShared";

export function selectedLaneDocument(lane: Pick<CareerLane, "kind" | "kind_settings" | "cv_type">, rawEntries: PracticeEntry[]) {
  if (!["creative", "cv", "performer"].includes(lane.kind || "")) return null;
  const entries = withCommonWords(rawEntries.map(cleanEntryText));
  const settings = readKindSettings(lane.kind_settings ?? {});
  const text = lane.kind === "cv" ? cvPlainText(buildCvModel(entries, settings, isCvType(lane.cv_type) ? lane.cv_type : "academic"))
    : lane.kind === "performer" ? performerPlainText(buildPerformerModel(entries, settings))
    : artistResumePlainText(buildArtistResumeModel(entries, settings));
  return { kind: lane.kind!, source: "current_visible_lane_document", text: text.slice(0, 18000), truncated: text.length > 18000,
    notice: "Current assembled document, not a submitted snapshot or a quality certification. Private notes, omitted entries and artist statements are not included. Use this lane's record tool for edits." };
}
export type LaneDocumentContext = ReturnType<typeof selectedLaneDocument>;
