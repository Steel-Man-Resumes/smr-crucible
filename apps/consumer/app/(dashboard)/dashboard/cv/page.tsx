"use client";

/**
 * CV: a CV lane's record and the CV built from it. Academic or research,
 * teaching, clinical, or international. The facts live once, in the practice
 * record; the CV is assembled from them with this lane's choices.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLanes } from "@/components/lanes/useLanes";
import { laneKindOf, CV_TYPES, type CareerLane, type CvType } from "@crucible/core/src/careerLaneShared";
import { CV_TYPE_COPY } from "@crucible/core/src/cvShared";
import { CV_INTRO, sendJson } from "@/lib/creative";
import { CvLaneView } from "@/components/creative/CvLaneView";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

function StartCvLane({ first, onCreated, onCancel }: { first: boolean; onCreated: (l: CareerLane) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [aim, setAim] = useState("");
  const [cvType, setCvType] = useState<CvType>("academic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      data-testid="cv-start"
      className="mt-6 border border-t-line bg-t-panel p-4 sm:p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const r = await sendJson<{ lane?: CareerLane }>("/api/lanes", "POST", { name: (name || aim || "CV").slice(0, 40), targetRole: aim, kind: "cv", cvType });
        setBusy(false);
        if (r.ok && r.data.lane) onCreated(r.data.lane);
        else setError(r.data.message || "That didn't save. Try again.");
      }}
    >
      <h2 className="text-sm font-semibold uppercase text-t-phos">{first ? "Start your CV" : "Another CV"}</h2>
      <fieldset className="space-y-2">
        <legend className="text-sm text-t-white">What kind of CV?</legend>
        {CV_TYPES.map((t) => (
          <label key={t} className={`flex gap-3 border p-3 cursor-pointer ${cvType === t ? "border-t-amber" : "border-t-line"}`}>
            <input type="radio" name="cv-type" value={t} checked={cvType === t} onChange={() => setCvType(t)} className="mt-1" data-testid={`cv-type-${t}`} />
            <span>
              <span className="block text-sm font-semibold text-t-white">{CV_TYPE_COPY[t].label}</span>
              <span className="block text-xs text-t-phos-dim">{CV_TYPE_COPY[t].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block text-sm text-t-white">
        What is it for? <span className="text-t-phos-dim">(optional)</span>
        <input className={`${inputCls} mt-1`} value={aim} maxLength={200} placeholder="Peer educator programs" onChange={(e) => setAim(e.target.value)} data-testid="cv-aim" />
      </label>
      <label className="block text-sm text-t-white">
        Lane name <span className="text-t-phos-dim">(optional)</span>
        <input className={`${inputCls} mt-1`} value={name} maxLength={40} placeholder="Teaching CV" onChange={(e) => setName(e.target.value)} data-testid="cv-name" />
      </label>
      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50" data-testid="cv-start-submit">
          {busy ? "Saving..." : "Start this CV"}
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

function CvInner() {
  const lanesApi = useLanes();
  const params = useSearchParams();
  const wanted = params.get("lane");
  const cvs = useMemo(() => lanesApi.lanes.filter((l) => laneKindOf(l) === "cv"), [lanesApi.lanes]);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!lanesApi.loaded) return;
    setLaneId((cur) => {
      if (cur && cvs.some((l) => l.id === cur)) return cur;
      if (wanted && cvs.some((l) => l.id === wanted)) return wanted;
      return cvs[0]?.id ?? null;
    });
  }, [lanesApi.loaded, cvs, wanted]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-bold text-t-white">CV</h1>
      <p className="text-t-phos-dim mt-1">{CV_INTRO}</p>
      {!lanesApi.loaded ? (
        <div className="mt-6 h-24 border border-t-line bg-t-panel" aria-hidden="true" />
      ) : (
        <>
          {cvs.length > 0 && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="cv-lane" className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">CV lane</label>
              <select id="cv-lane" value={laneId ?? ""} onChange={(e) => setLaneId(e.target.value)} className="t-focus min-h-touch w-full sm:max-w-xs bg-t-bg border border-t-line px-2 py-1 text-sm font-semibold text-t-white" data-testid="cv-lane-select">
                {cvs.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setStarting((v) => !v)} className="t-focus min-h-touch px-3 text-sm font-medium text-t-amber-bright border border-t-line" data-testid="cv-new">
                New CV
              </button>
            </div>
          )}
          {(cvs.length === 0 || starting) && (
            <StartCvLane
              first={cvs.length === 0}
              onCreated={(l) => {
                setStarting(false);
                lanesApi.adoptLane(l);
                setLaneId(l.id);
              }}
              onCancel={cvs.length ? () => setStarting(false) : undefined}
            />
          )}
          {laneId && !starting && <CvLaneView key={laneId} laneId={laneId} />}
        </>
      )}
    </div>
  );
}

export default function CvPage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto px-4 py-10 text-t-phos-dim">Loading...</div>}>
      <CvInner />
    </Suspense>
  );
}
