"use client";

/**
 * STUB (nav lane, 2026-10-23). The Steel Man meter lane replaces this file
 * whole. It reads GET /api/steelman and shows a compact bar when the answer
 * is ok; on 404, an error or a malformed answer it renders nothing.
 */
import { useEffect, useState } from "react";

interface MeterAnswer {
  score: number;
  maxScore: number;
  band: { id: string; label: string; why?: string };
}

function readMeter(raw: unknown): MeterAnswer | null {
  const data = raw as Partial<MeterAnswer> | null;
  if (!data || typeof data !== "object") return null;
  if (typeof data.score !== "number" || typeof data.maxScore !== "number" || !Number.isFinite(data.score) || !Number.isFinite(data.maxScore) || data.maxScore <= 0) return null;
  if (!data.band || typeof data.band.label !== "string") return null;
  return { score: data.score, maxScore: data.maxScore, band: { id: String(data.band.id ?? ""), label: data.band.label, why: typeof data.band.why === "string" ? data.band.why : undefined } };
}

export function SteelManMeter({ compact = false }: { compact?: boolean }) {
  const [meter, setMeter] = useState<MeterAnswer | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/steelman", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (live) setMeter(readMeter(body?.data ?? body)); })
      .catch(() => { if (live) setMeter(null); });
    return () => { live = false; };
  }, []);
  if (!meter) return null;
  const pct = Math.max(0, Math.min(100, Math.round((meter.score / meter.maxScore) * 100)));
  return (
    <div className={compact ? "px-3 py-2" : "p-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-term text-[10px] font-semibold uppercase text-t-bone-dim">Steel Man meter</p>
        <p className="font-term text-xs text-t-white">{meter.score}/{meter.maxScore}</p>
      </div>
      <div className="mt-1.5 h-1.5 w-full bg-t-panel-3" role="meter" aria-label="Steel Man meter" aria-valuemin={0} aria-valuemax={meter.maxScore} aria-valuenow={meter.score} aria-valuetext={`${meter.score} of ${meter.maxScore}, ${meter.band.label}`}>
        <div className="h-full bg-t-amber" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-t-bone-dim">{meter.band.label}</p>
    </div>
  );
}
