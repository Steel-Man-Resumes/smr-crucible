"use client";

/**
 * Teach the tools along the lanes (RT1): the first time a person opens a
 * tool in a lane, t.ROY says in one line what the tool does for that lane.
 * Dismissed once, it stays dismissed (lane_tool_intro, per lane and tool).
 */

import { useTranslations } from "next-intl";
import type { LaneTool } from "@crucible/core/src/careerLaneShared";
import { laneKey } from "@crucible/core/src/careerLaneShared";
import type { LanesApi } from "./useLanes";

export function LaneIntro({ lanes: api, tool, laneId }: { lanes: LanesApi; tool: LaneTool; laneId: string | null }) {
  const t = useTranslations("forgeEntry.laneIntro");
  if (!api.loaded) return null;
  const key = laneKey(laneId);
  if (api.introsSeen.has(`${key}:${tool}`)) return null;
  const lane = laneId ? api.lanes.find((l) => l.id === laneId) ?? null : null;
  // The one line per tool (laneIntroLine in lib/lanes.ts holds the English).
  const laneName = lane?.name ?? null;
  const line =
    tool === "tailor"
      ? laneName ? t("tailorNamed", { lane: laneName }) : t("tailor")
      : laneName ? t("libraryNamed", { lane: laneName }) : t("library");

  return (
    <aside
      data-testid="lane-intro"
      aria-label="t.ROY"
      className="flex items-start gap-3 border border-t-line border-l-4 border-l-t-amber bg-t-panel px-4 py-3"
    >
      <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-t-amber-bright">t.ROY</span>
      <p className="flex-1 text-sm text-t-phos">{line}</p>
      <button
        type="button"
        data-testid="lane-intro-dismiss"
        onClick={() => api.dismissIntro(key, tool)}
        className="t-focus shrink-0 min-h-touch px-2 text-xs font-medium text-t-phos-dim hover:text-t-white"
      >
        {t("gotIt")}
      </button>
    </aside>
  );
}
