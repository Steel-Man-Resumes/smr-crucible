"use client";

/**
 * Performer: a performer lane's record and the one-page performer resume built
 * from it (theater, film, TV, voice, music). The facts live once, in the
 * practice record; the page is assembled from them with this lane's choices.
 * A performer lane can be the dream beside a realistic lane, like a creative
 * lane: offered, never forced.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLanes } from "@/components/lanes/useLanes";
import { laneKindOf, type CareerLane, type LanePath } from "@crucible/core/src/careerLaneShared";
import { PERFORMER_INTRO, sendJson } from "@/lib/creative";
import { PerformerLaneView } from "@/components/creative/PerformerLaneView";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

function StartPerformerLane({ first, onCreated, onCancel }: { first: boolean; onCreated: (l: CareerLane) => void; onCancel?: () => void }) {
  const [what, setWhat] = useState("");
  const [name, setName] = useState("");
  const [path, setPath] = useState<LanePath | "none">("dream");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      data-testid="performer-start"
      className="mt-6 border border-t-line bg-t-panel p-4 sm:p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const r = await sendJson<{ lane?: CareerLane }>("/api/lanes", "POST", {
          name: (name || what || "Performer").trim().slice(0, 40),
          targetRole: what,
          kind: "performer",
          path: path === "none" ? null : path,
        });
        setBusy(false);
        if (r.ok && r.data.lane) onCreated(r.data.lane);
        else setError(r.data.message || "That didn't save. Try again.");
      }}
    >
      <h2 className="text-sm font-semibold uppercase text-t-phos">{first ? "Start your performer page" : "Another performer lane"}</h2>
      <p className="text-sm text-t-phos-dim">Theater, film, TV, voice, music. One page, the way casting reads it.</p>
      <label className="block text-sm text-t-white">
        What do you perform?
        <input className={`${inputCls} mt-1`} value={what} maxLength={120} placeholder="Stage and screen acting" onChange={(e) => setWhat(e.target.value)} data-testid="performer-what" />
      </label>
      <label className="block text-sm text-t-white">
        Lane name <span className="text-t-phos-dim">(optional)</span>
        <input className={`${inputCls} mt-1`} value={name} maxLength={40} placeholder="Acting" onChange={(e) => setName(e.target.value)} data-testid="performer-name" />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm text-t-white">Is this your dream, or the work you do now?</legend>
        {(
          [
            ["dream", "My dream", "Where I'm headed. You can pair it with work you can get now."],
            ["realistic", "What I do now", "Work I can get today."],
            ["none", "Not sure yet", "Skip this for now."],
          ] as const
        ).map(([v, label, body]) => (
          <label key={v} className="flex gap-3 border border-t-line p-3 cursor-pointer">
            <input type="radio" name="performer-path" value={v} checked={path === v} onChange={() => setPath(v)} className="mt-1" data-testid={`performer-path-${v}`} />
            <span>
              <span className="block text-sm font-semibold text-t-white">{label}</span>
              <span className="block text-xs text-t-phos-dim">{body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !what.trim()} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50" data-testid="performer-start-submit">
          {busy ? "Saving..." : "Start this lane"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PerformerInner() {
  const lanesApi = useLanes();
  const params = useSearchParams();
  const wanted = params.get("lane");
  const lanes = useMemo(() => lanesApi.lanes.filter((l) => laneKindOf(l) === "performer"), [lanesApi.lanes]);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!lanesApi.loaded) return;
    setLaneId((cur) => {
      if (cur && lanes.some((l) => l.id === cur)) return cur;
      if (wanted && lanes.some((l) => l.id === wanted)) return wanted;
      return lanes[0]?.id ?? null;
    });
  }, [lanesApi.loaded, lanes, wanted]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-bold text-t-white">Performer</h1>
      <p className="text-t-phos-dim mt-1">{PERFORMER_INTRO}</p>
      {!lanesApi.loaded ? (
        <div className="mt-6 h-24 border border-t-line bg-t-panel" aria-hidden="true" />
      ) : (
        <>
          {lanes.length > 0 && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="performer-lane" className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">Performer lane</label>
              <select id="performer-lane" value={laneId ?? ""} onChange={(e) => setLaneId(e.target.value)} className="t-focus min-h-touch w-full sm:max-w-xs bg-t-bg border border-t-line px-2 py-1 text-sm font-semibold text-t-white" data-testid="performer-lane-select">
                {lanes.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setStarting((v) => !v)} aria-expanded={starting} className="t-focus min-h-touch px-3 text-sm font-medium text-t-amber-bright border border-t-line" data-testid="performer-new">
                New performer lane
              </button>
            </div>
          )}
          {(lanes.length === 0 || starting) && (
            <StartPerformerLane
              first={lanes.length === 0}
              onCreated={(l) => {
                setStarting(false);
                lanesApi.adoptLane(l);
                setLaneId(l.id);
              }}
              onCancel={lanes.length ? () => setStarting(false) : undefined}
            />
          )}
          {laneId && !starting && (
            <PerformerLaneView
              key={laneId}
              laneId={laneId}
              allLanes={lanesApi.lanes}
              onLanesChanged={() => lanesApi.refresh()}
              onAdoptLane={(l) => lanesApi.adoptLane(l)}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function PerformerPage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto px-4 py-10 text-t-phos-dim">Loading...</div>}>
      <PerformerInner />
    </Suspense>
  );
}
