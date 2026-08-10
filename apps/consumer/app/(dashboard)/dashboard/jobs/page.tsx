"use client";

/**
 * Job Board — Refinery Tool 4
 *
 * Real listings from JSearch API. Fair-chance flagged.
 * Everything renders natively — no outbound links.
 * Save jobs to track applications across the Refinery.
 */

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TierGate } from "@/components/TierGate";
import { GhostGuide } from "@crucible/consumer-ui";
import { getOpusMessage } from "@/lib/opus-messages";
import { useUserContext } from "@/lib/use-user-context";
import { trackProgress } from "@/lib/track-progress";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EnrichedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  description: string;
  full_description?: string;
  requirements: string[];
  benefits: string[];
  employment_type: string;
  posted: string;
  second_chance: boolean;
  fair_chance_reason: string | null;
  remote: boolean;
  apply_url?: string | null;
  employer_website?: string | null;
}

interface SavedJob {
  id: string;
  status: "saved" | "applied" | "heard_back" | "interviewing" | "offered";
}

interface UserContext {
  targetRole: string;
  location: string;
  skills: string[];
  hasRecord: boolean;
  recordType?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const COMMON_ROLES = [
  "Warehouse Associate",
  "Customer Service",
  "Forklift Operator",
  "General Labor",
  "Production Worker",
  "CDL Driver",
  "Food Service",
  "Construction",
  "Janitorial / Cleaning",
  "Retail Associate",
];

// Light client-side employer key for immediate display filtering. The authoritative,
// suffix-tolerant match runs server-side in /api/job-search (core normalizeEmployerName).
function lightEmployerKey(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function JobBoardPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <Suspense><JobBoardPage /></Suspense>
    </TierGate>
  );
}

function JobBoardPage() {
  const searchParams = useSearchParams();
  const autoSearched = useRef(false);
  const forgeLoadedRef = useRef(false);
  const { context: userContext } = useUserContext();
  const [context, setContext] = useState<UserContext>({
    targetRole: "",
    location: "",
    skills: [],
    hasRecord: false,
  });
  const [jobs, setJobs] = useState<EnrichedJob[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [fairChanceInfo, setFairChanceInfo] = useState("");
  const [source, setSource] = useState("");
  const [rateLimitError, setRateLimitError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [savedJobs, setSavedJobs] = useState<Map<string, SavedJob>>(new Map());
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());
  // N1: persistent per-employer hiding (normalized name keys) + the card being confirmed.
  const [hiddenEmployerKeys, setHiddenEmployerKeys] = useState<Set<string>>(new Set());
  const [hideEmployerFor, setHideEmployerFor] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState("");
  const [fairChanceOnly, setFairChanceOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [roleFromResume, setRoleFromResume] = useState(false);

  // Restore the last search (query + results) so navigating away and back
  // doesn't wipe the user's work. Kept for 6 hours to match the server cache.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("refinery_last_job_search");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.ts || Date.now() - saved.ts > 6 * 60 * 60 * 1000) return;
      if (Array.isArray(saved.jobs) && saved.jobs.length > 0) {
        setContext((prev) => ({ ...prev, ...(saved.context || {}) }));
        setJobs(saved.jobs);
        setFairChanceInfo(saved.fairChanceInfo || "");
        setSource(saved.source || "");
        setSearched(true);
      }
    } catch {}
  }, []);

  // Load saved/hidden state
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hidden_jobs");
      if (stored) setHiddenJobs(new Set(JSON.parse(stored)));
    } catch {}

    // N1: the user's hidden employers, so restored/cached listings are filtered too.
    fetch("/api/user/hidden-employers")
      .then((r) => (r.ok ? r.json() : { employers: [] }))
      .then((d) =>
        setHiddenEmployerKeys(
          new Set((d.employers || []).map((e: { display_name: string }) => lightEmployerKey(e.display_name)))
        )
      )
      .catch(() => {});

    // Load saved jobs from API (DB-backed)
    async function loadSavedJobs() {
      try {
        const res = await fetch("/api/applications");
        if (res.ok) {
          const data = await res.json();
          const map = new Map<string, SavedJob>();
          for (const app of data.applications || []) {
            // Use source_id (JSearch job ID) as the key to match against search results
            const key = app.source_id || app.id;
            map.set(key, { id: app.id, status: app.status });
          }
          setSavedJobs(map);
        }
      } catch {
        // Fallback to localStorage
        try {
          const stored = localStorage.getItem("saved_jobs");
          if (stored) {
            const arr: SavedJob[] = JSON.parse(stored);
            setSavedJobs(new Map(arr.map((j) => [j.id, j])));
          }
        } catch {}
      }
    }
    loadSavedJobs();
  }, []);

  // Load context from the SERVER (not fragile cross-domain localStorage, which is
  // empty on refinery.* for users whose Forge was saved server-side at signup).
  // Runs once when context arrives; never overrides a role/location the user set
  // or that came from a URL param. Record details stay private -- /api/user/context
  // exposes only the hasRecord flag (drives fair-chance filtering), not the type.
  useEffect(() => {
    if (!userContext || forgeLoadedRef.current) return;
    forgeLoadedRef.current = true;
    const f = userContext.forge;

    const top = f?.careerPaths?.[0];
    const careerRole = top ? (typeof top === "string" ? top : top.title) : "";
    // Phase 4C: prefer the user's most recent tailored resume's target role over
    // the generic Forge career path -- it is the job they actually built toward.
    const resumeRole =
      ((userContext as any).resumes ?? []).find((r: any) => r && r.targetJob)?.targetJob || "";
    const role = resumeRole || careerRole;
    if (resumeRole) setRoleFromResume(true);
    const loc = [userContext.profile?.city, userContext.profile?.state]
      .filter(Boolean)
      .join(", ");
    const skills = (f?.skills ?? [])
      .map((s) => (typeof s === "string" ? s : s.name))
      .filter(Boolean)
      .slice(0, 10);

    setContext((prev) => ({
      ...prev,
      targetRole: prev.targetRole || role,
      location: prev.location || loc,
      skills: skills.length ? skills : prev.skills,
      hasRecord: f?.hasCriminalRecord ?? prev.hasRecord,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userContext]);

  // Auto-search from URL param (e.g., ?q=Warehouse+Associate from dashboard CTA)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoSearched.current) {
      autoSearched.current = true;
      setContext((prev) => ({ ...prev, targetRole: q }));
    }
  }, [searchParams]);

  // Trigger search when context is set from URL param
  useEffect(() => {
    if (autoSearched.current && context.targetRole && !searched) {
      searchJobs();
    }
  }, [context.targetRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions ────────────────────────────────────────────────────────────

  async function searchJobs() {
    if (!context.targetRole && !context.location) return;
    setSearching(true);
    setSearched(true);
    setRateLimitError("");
    setSearchError("");

    try {
      const res = await fetch("/api/job-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        if (data.error) {
          // The job-data provider failed (quota/outage) -- say so plainly
          // instead of showing a misleading "no jobs found".
          setJobs([]);
          setSearchError(
            data.error === "provider_rate_limited"
              ? "Our job-listing provider hit its limit for right now. This is on our side, not yours -- your search was fine. Try again in a little while."
              : "We couldn't reach the job listings just now. This is on our side, not yours. Try again in a few minutes."
          );
        } else {
          setJobs(data.jobs || []);
          setFairChanceInfo(data.fair_chance_info || "");
          setSource(data.source || "");
          try {
            localStorage.setItem(
              "refinery_last_job_search",
              JSON.stringify({
                ts: Date.now(),
                context,
                jobs: data.jobs || [],
                fairChanceInfo: data.fair_chance_info || "",
                source: data.source || "",
              })
            );
          } catch {}
        }
      } else {
        setJobs([]);
        setSearchError(
          "Something went wrong on our end running that search. Try again in a few minutes."
        );
      }
    } catch {
      setJobs([]);
      setSearchError(
        "We couldn't reach the server. Check your connection and try again."
      );
    } finally {
      setSearching(false);
    }

    // Track search
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.job_searches = (tracker.job_searches || 0) + 1;
      tracker.last_job_search = new Date().toISOString();
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
    trackProgress("job_search");
  }

  async function saveJob(job: EnrichedJob) {
    // Optimistic UI update
    setSavedJobs((prev) => {
      const next = new Map(prev);
      next.set(job.id, { id: job.id, status: "saved" });
      return next;
    });

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_title: job.title,
          company: job.company,
          location: job.location,
          salary: job.salary,
          description: job.description,
          employment_type: job.employment_type,
          source: "jsearch",
          source_id: job.id,
          apply_url: job.apply_url || null,
          employer_website: job.employer_website || null,
          status: "saved",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedJobs((prev) => {
          const next = new Map(prev);
          next.set(job.id, { id: data.application.id, status: "saved" });
          return next;
        });
      }
    } catch {}
  }

  async function markApplied(jobId: string) {
    const saved = savedJobs.get(jobId);
    const dbId = saved?.id || jobId;

    setSavedJobs((prev) => {
      const next = new Map(prev);
      next.set(jobId, { id: dbId, status: "applied" });
      return next;
    });

    try {
      await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dbId, status: "applied" }),
      });
    } catch {}

    // Track application in progress
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.applications_sent = (tracker.applications_sent || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }

  async function unsaveJob(jobId: string) {
    const saved = savedJobs.get(jobId);

    setSavedJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });

    if (saved?.id) {
      try {
        await fetch("/api/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: saved.id, status: "rejected" }),
        });
      } catch {}
    }
  }

  function dismissJob(jobId: string) {
    setHiddenJobs((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      localStorage.setItem("hidden_jobs", JSON.stringify(Array.from(next)));
      return next;
    });
  }

  // N1: hide an employer for good. Server matching is suffix-tolerant (next search);
  // this light client key removes the currently-shown listings immediately.
  async function hideEmployer(company: string) {
    const name = (company || "").trim();
    if (!name) return;
    try {
      await fetch("/api/user/hidden-employers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reason: hideReason.trim() || undefined }),
      });
    } catch {}
    setHiddenEmployerKeys((prev) => new Set(prev).add(lightEmployerKey(name)));
    setHideEmployerFor(null);
    setHideReason("");
  }

  // ─── Derived ────────────────────────────────────────────────────────────

  const visibleJobs = jobs.filter((j) => {
    if (hiddenJobs.has(j.id)) return false;
    if (hiddenEmployerKeys.has(lightEmployerKey(j.company))) return false;
    if (fairChanceOnly && !j.second_chance) return false;
    if (remoteOnly && !j.remote) return false;
    return true;
  });
  const hiddenCount = jobs.length - visibleJobs.length;
  const savedCount = savedJobs.size;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">
        Job Board
      </h1>
      <GhostGuide message={getOpusMessage("jobs")} pageId="jobs" />
      <p className="text-base text-t-phos-dim mb-6">
        Real job listings updated daily. Fair-chance employers highlighted.
        Everything stays right here in your dashboard.
      </p>

      {/* Cross-link into the curated fair-chance lanes (completes the loop) */}
      <Link
        href="/dashboard/resources"
        className="t-focus flex items-center justify-between gap-3 bg-t-panel border border-t-line px-4 py-3 mb-6 hover:border-t-phos-dim transition-colors"
      >
        <span className="text-sm text-t-phos">
          <span className="font-semibold text-t-white">Not sure where to start?</span>{" "}
          Explore curated fair-chance lanes for your field.
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="text-t-amber flex-shrink-0"
          aria-hidden="true"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      {/* Saved jobs summary */}
      {savedCount > 0 && (
        <div className="bg-t-panel p-4 border border-t-line mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-t-amber-bright">
                {savedCount} saved job{savedCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-t-phos-dim ml-2">
                {Array.from(savedJobs.values()).filter(
                  (j) => j.status === "applied"
                ).length}{" "}
                applied
              </span>
            </div>
            <span className="text-xs text-t-phos-dim">
              Application tracking coming soon
            </span>
          </div>
        </div>
      )}

      {/* Search form */}
      <div className="bg-t-panel p-5 border border-t-line mb-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              What kind of work?
            </label>
            <input
              value={context.targetRole}
              onChange={(e) =>
                setContext({ ...context, targetRole: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder="e.g., Warehouse, CDL Driver, Forklift"
              data-tour="jobs-search-role"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
            />
            <p className="text-xs text-t-phos-dim mt-1">
              You can combine terms -- e.g., &quot;Forklift, Warehouse&quot; or &quot;CNA, Medical&quot;
            </p>
            {roleFromResume && context.targetRole && (
              <p className="text-xs text-t-amber-bright mt-1">
                Seeded from your most recent resume -- edit it anytime.
              </p>
            )}
            {/* Quick picks — click to set or append */}
            <div className="flex flex-wrap gap-2 mt-2">
              {COMMON_ROLES.slice(0, 6).map((role) => {
                const isActive = context.targetRole === role;
                return (
                  <button
                    key={role}
                    onClick={() => setContext({
                      ...context,
                      targetRole: isActive ? "" : role,
                    })}
                    className={`t-focus text-xs px-3 py-1.5 border transition-colors ${
                      isActive
                        ? "bg-t-panel-2 border-t-amber text-t-amber-bright"
                        : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-t-white block mb-1">Where?</label>
            <input
              value={context.location}
              onChange={(e) =>
                setContext({ ...context, location: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder="City, State (e.g., Milwaukee, WI)"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
            />
          </div>

          <button
            onClick={searchJobs}
            disabled={searching || (!context.targetRole && !context.location)}
            data-tour="jobs-search-button"
            className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
          >
            {searching ? "Searching real listings..." : "Find Jobs"}
          </button>
        </div>
      </div>

      {/* Phase 4C: result filters -- refine the listings you already pulled */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-medium text-t-phos-dim">Filter:</span>
          <button
            onClick={() => setFairChanceOnly((v) => !v)}
            className={`t-focus text-xs px-3 py-1.5 border transition-colors ${fairChanceOnly ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            Fair chance only
          </button>
          <button
            onClick={() => setRemoteOnly((v) => !v)}
            className={`t-focus text-xs px-3 py-1.5 border transition-colors ${remoteOnly ? "bg-t-steel text-white border-t-steel font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            Remote only
          </button>
          <span className="text-xs text-t-phos-dim ml-auto">
            {visibleJobs.length} of {jobs.length} shown
          </span>
        </div>
      )}

      {/* Rate limit warning */}
      {rateLimitError && (
        <div className="bg-t-panel p-5 border border-t-amber mb-6">
          <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
        </div>
      )}

      {/* Search failure -- never let an outage read as "no jobs exist" */}
      {searchError && !searching && (
        <div className="bg-t-panel p-5 border border-t-red mb-6">
          <p className="text-sm font-semibold text-t-red mb-1">
            Job search is having trouble right now
          </p>
          <p className="text-sm text-t-phos leading-relaxed">{searchError}</p>
        </div>
      )}

      {/* Fair chance info box */}
      {fairChanceInfo && (
        <div className="bg-t-panel p-5 border border-t-steel mb-6">
          <h2 className="font-semibold text-t-steel mb-2">
            Fair-Chance Hiring in Your Area
          </h2>
          <p className="text-sm text-t-phos leading-relaxed">
            {fairChanceInfo}
          </p>
        </div>
      )}

      {/* Loading */}
      {searching && (
        <div className="flex items-center gap-3 py-12 justify-center text-t-phos-dim">
          <div className="w-5 h-5 border-2 border-t-amber border-t-transparent animate-spin" />
          Searching real job listings...
        </div>
      )}

      {/* No results */}
      {!searching && searched && !searchError && visibleJobs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-t-phos-dim mb-3">
            No listings found for this search right now. Try:
          </p>
          <ul className="text-sm text-t-phos-dim space-y-1">
            <li>A broader role (e.g., &quot;General Labor&quot; instead of a specific title)</li>
            <li>A different location or just &quot;Milwaukee, WI&quot;</li>
            <li>Searching again in a day — new jobs post every day</li>
          </ul>
        </div>
      )}

      {/* CareerOneStop attribution -- required by DOL API terms when their data is shown */}
      {source === "careeronestop" && visibleJobs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-t-phos-dim">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cos-logo-star.svg" alt="CareerOneStop" className="h-5 w-auto" />
          <span>
            Job listings provided by CareerOneStop, sponsored by the U.S.
            Department of Labor.
          </span>
        </div>
      )}

      {/* Results */}
      {!searching && visibleJobs.length > 0 && (
        <div className="space-y-3">
          {visibleJobs.map((job, jobIndex) => {
            const isSaved = savedJobs.has(job.id);
            const savedStatus = savedJobs.get(job.id)?.status;
            const isExpanded = expandedJob === job.id;

            return (
              <div
                key={job.id}
                data-tour={jobIndex === 0 ? "jobs-first-result" : undefined}
                className="bg-t-panel border border-t-line overflow-hidden transition-colors hover:border-t-phos-dim"
              >
                {/* Header — always visible */}
                <button
                  onClick={() =>
                    setExpandedJob(isExpanded ? null : job.id)
                  }
                  className="w-full text-left p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-t-white">
                          {job.title}
                        </h3>
                        {job.second_chance && (
                          <span className="text-[10px] font-medium border border-t-amber text-t-amber-bright px-2 py-0.5 whitespace-nowrap">
                            Fair Chance
                          </span>
                        )}
                        {job.remote && (
                          <span className="text-[10px] font-medium border border-t-steel text-t-steel px-2 py-0.5 whitespace-nowrap">
                            Remote
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-t-phos-dim">{job.company}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-t-phos-dim flex-wrap">
                        {job.location && <span>{job.location}</span>}
                        {job.salary && (
                          <span className="font-medium text-t-amber-bright">
                            {job.salary}
                          </span>
                        )}
                        {job.employment_type && (
                          <span>{job.employment_type}</span>
                        )}
                        {job.posted && <span>{job.posted}</span>}
                      </div>
                    </div>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      className={`text-t-phos-dim flex-shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path
                        d="M4 6l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  </div>

                  {/* Brief description — always visible */}
                  <p className="text-sm text-t-phos-dim mt-2 leading-relaxed line-clamp-2">
                    {job.description}
                  </p>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t border-t-line pt-4">
                    {/* Company / salary / type meta row */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium text-t-white">{job.company}</span>
                      {job.salary && (
                        <span className="text-t-amber-bright font-medium">{job.salary}</span>
                      )}
                      {job.employment_type && (
                        <span className="text-t-phos-dim">{job.employment_type}</span>
                      )}
                      {job.remote && <span className="text-t-steel font-medium">Remote</span>}
                    </div>

                    {/* Full description */}
                    <div className="text-sm text-t-phos leading-relaxed space-y-2">
                      {(job.full_description || job.description)
                        .split(/\n{2,}/)
                        .filter(Boolean)
                        .map((para, i) => (
                          <p key={i}>{para.trim()}</p>
                        ))}
                    </div>

                    {/* Fair chance reason */}
                    {job.fair_chance_reason && (
                      <div className="bg-t-panel-2 px-3 py-2 border border-t-amber">
                        <p className="text-xs font-medium text-t-amber-bright">
                          Fair-chance employer -- {job.fair_chance_reason}
                        </p>
                      </div>
                    )}

                    {/* Requirements */}
                    {job.requirements.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-t-white mb-1.5 uppercase">
                          What they&apos;re looking for
                        </h4>
                        <ul className="text-sm text-t-phos-dim space-y-1">
                          {job.requirements.map((r, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-t-amber flex-shrink-0">
                                &bull;
                              </span>
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Benefits */}
                    {job.benefits.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-t-white mb-1.5 uppercase">
                          Benefits
                        </h4>
                        <ul className="text-sm text-t-phos-dim space-y-1">
                          {job.benefits.map((b, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-t-amber flex-shrink-0">
                                &bull;
                              </span>
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Actions -- do the work HERE first (save, tailor); the
                        external employer link is deliberately the LAST step. */}
                    <div className="flex items-center gap-3 pt-2 flex-wrap">
                      {!isSaved ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveJob(job);
                          }}
                          className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
                        >
                          Save Job
                        </button>
                      ) : savedStatus === "saved" ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markApplied(job.id);
                            }}
                            className="t-focus px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
                          >
                            Mark Applied
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              unsaveJob(job.id);
                            }}
                            className="text-xs text-t-phos-dim hover:text-t-white"
                          >
                            Unsave
                          </button>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-t-amber-bright border border-t-amber px-3 py-1.5">
                          Applied
                        </span>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          sessionStorage.setItem("resume_target_job", JSON.stringify(job));
                          window.location.href = "/dashboard/application-tailor?from=job";
                        }}
                        data-tour={jobIndex === 0 ? "jobs-tailor-button" : undefined}
                        className="t-focus px-4 py-2 bg-transparent border border-t-steel text-t-steel text-sm font-bold hover:bg-t-steel hover:text-white transition-colors"
                      >
                        Tailor My Resume for This Job
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissJob(job.id);
                        }}
                        className="text-xs text-t-phos-dim hover:text-t-white ml-auto"
                      >
                        Not for me
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setHideReason("");
                          setHideEmployerFor(hideEmployerFor === job.id ? null : job.id);
                        }}
                        className="text-xs text-t-phos-dim hover:text-t-red"
                        title="Hide this employer from your searches"
                      >
                        Hide employer
                      </button>
                    </div>

                    {/* N1: type-to-confirm + optional reason before hiding an employer. */}
                    {hideEmployerFor === job.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 border border-t-line bg-t-panel-2 p-3"
                      >
                        <p className="text-xs text-t-phos">
                          Hide <strong className="text-t-white">{job.company}</strong> from all your
                          future searches. You can undo this anytime in Settings.
                        </p>
                        <textarea
                          value={hideReason}
                          onChange={(e) => setHideReason(e.target.value)}
                          placeholder="Reason (optional) -- e.g. a former employer, or already applied"
                          rows={2}
                          className="mt-2 w-full px-3 py-2 text-xs bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none resize-y"
                        />
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => hideEmployer(job.company)}
                            className="t-focus px-3 py-1.5 text-xs font-bold bg-t-red text-white hover:opacity-90"
                          >
                            Hide {job.company}
                          </button>
                          <button
                            onClick={() => { setHideEmployerFor(null); setHideReason(""); }}
                            className="text-xs text-t-phos-dim hover:text-t-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* External apply -- the LAST step, after saving and tailoring here */}
                    {(job.apply_url || job.employer_website) && (
                      <div className="bg-t-panel-2 px-3 py-2 border border-t-line">
                        <p className="text-xs text-t-phos mb-1">
                          <strong className="text-t-white">Last step:</strong>{" "}
                          when your resume is ready, apply on the employer&apos;s
                          site. Save the job first so it lands in your
                          Applications list. Always confirm the posting is still
                          open.
                        </p>
                        {job.apply_url ? (
                          <a
                            href={job.apply_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-t-steel underline underline-offset-2 hover:opacity-80 break-all"
                          >
                            Open the employer&apos;s application page &#8599;
                          </a>
                        ) : job.employer_website ? (
                          <a
                            href={job.employer_website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-t-steel underline underline-offset-2 hover:opacity-80"
                          >
                            {job.employer_website} &#8599;
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Hidden jobs toggle */}
          {hiddenCount > 0 && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setHiddenJobs(new Set())}
                className="text-xs text-t-phos-dim hover:text-t-white underline underline-offset-2"
              >
                Show {hiddenCount} hidden job{hiddenCount !== 1 ? "s" : ""}
              </button>
            </div>
          )}

          <p className="text-xs text-t-phos-dim text-center py-4">
            Listings sourced from real job boards. Updated daily.
            Always confirm details directly with the employer.
          </p>
        </div>
      )}

      {/* How it works — always visible at bottom */}
      <div className="mt-8 pt-6 border-t border-t-line">
        <h2 className="text-sm font-semibold text-t-white mb-3">
          How This Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">Real Listings</span>
            <span className="text-xs text-t-phos-dim">
              Every job here is a real posting from employers hiring right now
              in your area.
            </span>
          </div>
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">Fair Chance First</span>
            <span className="text-xs text-t-phos-dim">
              Companies known to hire people with records are highlighted and
              shown first.
            </span>
          </div>
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">Save &amp; Track</span>
            <span className="text-xs text-t-phos-dim">
              Save jobs you like. Mark when you apply. Build your resume and
              practice interviews for each one.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
