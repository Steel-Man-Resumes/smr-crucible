"use client";

/**
 * "Which resume am I searching as" selector (Wave R / R6).
 *
 * A user can hold several APPROVED baseline resumes -- one per career lane
 * (manufacturing, culinary, leadership, ...) plus their pinned "current" resume.
 * This picks the ACTIVE baseline the tailor will restructure (R5): tailoring
 * within a lane sharpens that baseline without downgrading it. The choice is
 * persisted to localStorage (`active_baseline_id`) and read by the tailor flow.
 *
 * Renders nothing until the user has at least one approved baseline (a locked
 * baseline or a pinned current), so it stays out of a new user's way.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ResumeArtifact {
  id: string;
  target_context: { targetJob?: string; targetCompany?: string; source?: string } | null;
  lane?: string | null;
  is_locked?: boolean;
  is_current?: boolean;
}

function labelFor(a: ResumeArtifact): string {
  if (a.lane && a.lane.trim()) return a.lane.trim();
  const job = a.target_context?.targetJob;
  if (job && job !== "General") return job;
  return "Base resume";
}

export function BaselineSelector({ className = "" }: { className?: string }) {
  const [candidates, setCandidates] = useState<ResumeArtifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBaselines = useCallback(async () => {
    try {
      const res = await fetch("/api/artifacts?type=resume&limit=50");
      if (res.ok) {
        const { data } = await res.json();
        const resumes: ResumeArtifact[] = (data || []).filter(Boolean);
        // Only APPROVED resumes qualify: locked baselines + the pinned current.
        const cands = resumes.filter((a) => a.is_locked || a.is_current);
        setCandidates(cands);

        let stored: string | null = null;
        try {
          stored = localStorage.getItem("active_baseline_id");
        } catch {}
        const valid = stored && cands.some((c) => c.id === stored) ? stored : null;
        const fallback = cands.find((c) => c.is_current)?.id || cands[0]?.id || null;
        const active = valid || fallback;
        setActiveId(active);
        if (active && active !== stored) {
          try {
            localStorage.setItem("active_baseline_id", active);
          } catch {}
        }
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBaselines();
    const onChange = () => loadBaselines();
    window.addEventListener("baseline-changed", onChange);
    return () => window.removeEventListener("baseline-changed", onChange);
  }, [loadBaselines]);

  function choose(id: string) {
    setActiveId(id);
    try {
      localStorage.setItem("active_baseline_id", id);
    } catch {}
    try {
      window.dispatchEvent(new Event("baseline-changed"));
    } catch {}
  }

  if (loading || candidates.length === 0) return null;

  const active = candidates.find((c) => c.id === activeId) || candidates[0];

  return (
    <div className={`flex items-center gap-2 flex-wrap text-xs ${className}`}>
      <span className="text-t-phos-dim">Searching as</span>
      {candidates.length === 1 ? (
        <span className="font-semibold text-t-white">
          {labelFor(active)}
          {active.is_current ? " (current)" : ""}
        </span>
      ) : (
        <select
          value={active.id}
          onChange={(e) => choose(e.target.value)}
          className="t-focus bg-t-panel border border-t-line text-t-white font-semibold px-2 py-1 focus:border-t-steel focus:outline-none"
          aria-label="Which resume am I searching as"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {labelFor(c)}
              {c.is_current ? " (current)" : ""}
            </option>
          ))}
        </select>
      )}
      <Link
        href="/dashboard/vault"
        className="t-focus text-t-steel hover:text-t-white transition-colors"
      >
        Manage baselines
      </Link>
    </div>
  );
}
