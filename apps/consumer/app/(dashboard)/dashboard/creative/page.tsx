"use client";

/**
 * Creative work: a creative lane's practice record and documents (artist
 * resume, bio, the person's own statement, work samples), and the
 * realistic/dream pair with its private plan card.
 *
 * A creative lane is a career lane of kind "creative" (migration 075). The
 * facts live once, in the practice record; every page is built from it.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLanes } from "@/components/lanes/useLanes";
import { laneKindOf } from "@crucible/core/src/careerLaneShared";
import { CREATIVE_INTRO } from "@/lib/creative";
import { CreativeLaneView } from "@/components/creative/CreativeLaneView";
import { StartCreativeLane } from "@/components/creative/StartCreativeLane";

function CreativeInner() {
  const lanesApi = useLanes();
  const params = useSearchParams();
  const wanted = params.get("lane");
  const startTab = params.get("start") === "practice" ? "record" : null;
  const creative = useMemo(() => lanesApi.lanes.filter((l) => laneKindOf(l) === "creative"), [lanesApi.lanes]);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!lanesApi.loaded) return;
    setLaneId((cur) => {
      if (cur && creative.some((l) => l.id === cur)) return cur;
      if (wanted && creative.some((l) => l.id === wanted)) return wanted;
      if (creative.some((l) => l.id === lanesApi.active)) return lanesApi.active;
      return creative[0]?.id ?? null;
    });
  }, [lanesApi.loaded, creative, wanted, lanesApi.active]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-bold text-t-white">Creative work</h1>
      <p className="text-t-phos-dim mt-1">{CREATIVE_INTRO}</p>

      {!lanesApi.loaded ? (
        <div className="mt-6 h-24 border border-t-line bg-t-panel" aria-hidden="true" />
      ) : (
        <>
          {creative.length > 0 && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="creative-lane-picker">
              <label htmlFor="creative-lane" className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">
                Creative lane
              </label>
              <select
                id="creative-lane"
                data-testid="creative-lane-select"
                value={laneId ?? ""}
                onChange={(e) => {
                  setLaneId(e.target.value);
                  lanesApi.setActive(e.target.value);
                }}
                className="t-focus min-h-touch w-full sm:max-w-xs bg-t-bg border border-t-line px-2 py-1 text-sm font-semibold text-t-white"
              >
                {creative.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="creative-new"
                onClick={() => setStarting((v) => !v)}
                aria-expanded={starting}
                className="t-focus min-h-touch px-3 text-sm font-medium text-t-amber-bright border border-t-line hover:text-t-amber"
              >
                New creative lane
              </button>
            </div>
          )}

          {(creative.length === 0 || starting) && (
            <StartCreativeLane
              first={creative.length === 0}
              onCreated={(lane) => {
                setStarting(false);
                lanesApi.adoptLane(lane);
                setLaneId(lane.id);
              }}
              onCancel={creative.length ? () => setStarting(false) : undefined}
            />
          )}

          {laneId && !starting && (
            <CreativeLaneView
              key={laneId}
              laneId={laneId}
              allLanes={lanesApi.lanes}
              startTab={startTab}
              onLanesChanged={() => lanesApi.refresh()}
              onAdoptLane={(l) => lanesApi.adoptLane(l)}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function CreativePage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto px-4 py-10 text-t-phos-dim">Loading...</div>}>
      <CreativeInner />
    </Suspense>
  );
}
