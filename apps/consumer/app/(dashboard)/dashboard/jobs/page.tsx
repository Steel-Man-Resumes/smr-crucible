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
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [savedJobs, setSavedJobs] = useState<Map<string, SavedJob>>(new Map());
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());
  const [fairChanceOnly, setFairChanceOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [roleFromResume, setRoleFromResume] = useState(false);

  // Load saved/hidden state
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hidden_jobs");
      if (stored) setHiddenJobs(new Set(JSON.parse(stored)));
    } catch {}

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
        setJobs(data.jobs || []);
        setFairChanceInfo(data.fair_chance_info || "");
        setSource(data.source || "");
      }
    } catch {
      setJobs([]);
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

  // ─── Derived ────────────────────────────────────────────────────────────

  const visibleJobs = jobs.filter((j) => {
    if (hiddenJobs.has(j.id)) return false;
    if (fairChanceOnly && !j.second_chance) return false;
    if (remoteOnly && !j.remote) return false;
    return true;
  });
  const hiddenCount = jobs.length - visibleJobs.length;
  const savedCount = savedJobs.size;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        Job Board
      </h1>
      <GhostGuide message={getOpusMessage("jobs")} pageId="jobs" />
      <p className="text-body text-muted mb-6">
        Real job listings updated daily. Fair-chance employers highlighted.
        Everything stays right here in your dashboard.
      </p>

      {/* Cross-link into the curated fair-chance lanes (completes the loop) */}
      <Link
        href="/dashboard/resources"
        className="flex items-center justify-between gap-3 bg-sage-50 border border-sage-200 rounded-xl px-4 py-3 mb-6 hover:bg-sage-100 transition-colors"
      >
        <span className="text-sm text-sage-800">
          <span className="font-semibold">Not sure where to start?</span>{" "}
          Explore curated fair-chance lanes for your field.
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="text-sage-600 flex-shrink-0"
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
        <div className="bg-sage-50 rounded-xl p-4 border border-sage-200 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-sage-700">
                {savedCount} saved job{savedCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted ml-2">
                {Array.from(savedJobs.values()).filter(
                  (j) => j.status === "applied"
                ).length}{" "}
                applied
              </span>
            </div>
            <span className="text-xs text-muted">
              Application tracking coming soon
            </span>
          </div>
        </div>
      )}

      {/* Search form */}
      <div className="bg-white rounded-2xl p-5 border border-border mb-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
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
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch focus:border-sage-600 transition-colors"
            />
            <p className="text-xs text-muted mt-1">
              You can combine terms -- e.g., &quot;Forklift, Warehouse&quot; or &quot;CNA, Medical&quot;
            </p>
            {roleFromResume && context.targetRole && (
              <p className="text-xs text-sage-600 mt-1">
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
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      isActive
                        ? "bg-sage-100 border-sage-300 text-sage-700"
                        : "bg-gray-50 border-gray-200 text-muted hover:border-sage-300"
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Where?</label>
            <input
              value={context.location}
              onChange={(e) =>
                setContext({ ...context, location: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder="City, State (e.g., Milwaukee, WI)"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch focus:border-sage-600 transition-colors"
            />
          </div>

          <button
            onClick={searchJobs}
            disabled={searching || (!context.targetRole && !context.location)}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
          >
            {searching ? "Searching real listings..." : "Find Jobs"}
          </button>
        </div>
      </div>

      {/* Phase 4C: result filters -- refine the listings you already pulled */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-medium text-muted">Filter:</span>
          <button
            onClick={() => setFairChanceOnly((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${fairChanceOnly ? "bg-sage-600 text-white border-sage-600" : "bg-white border-border text-muted hover:border-sage-300"}`}
          >
            Fair chance only
          </button>
          <button
            onClick={() => setRemoteOnly((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${remoteOnly ? "bg-sky-600 text-white border-sky-600" : "bg-white border-border text-muted hover:border-sky-300"}`}
          >
            Remote only
          </button>
          <span className="text-xs text-muted ml-auto">
            {visibleJobs.length} of {jobs.length} shown
          </span>
        </div>
      )}

      {/* Rate limit warning */}
      {rateLimitError && (
        <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200 mb-6">
          <p className="text-sm text-amber-800">{rateLimitError}</p>
        </div>
      )}

      {/* Fair chance info box */}
      {fairChanceInfo && (
        <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-6">
          <h2 className="font-semibold text-sky-800 mb-2">
            Fair-Chance Hiring in Your Area
          </h2>
          <p className="text-sm text-sky-700 leading-relaxed">
            {fairChanceInfo}
          </p>
        </div>
      )}

      {/* Loading */}
      {searching && (
        <div className="flex items-center gap-3 py-12 justify-center text-muted">
          <div className="w-5 h-5 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
          Searching real job listings...
        </div>
      )}

      {/* No results */}
      {!searching && searched && visibleJobs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted mb-3">
            No listings found for this search right now. Try:
          </p>
          <ul className="text-sm text-muted space-y-1">
            <li>A broader role (e.g., &quot;General Labor&quot; instead of a specific title)</li>
            <li>A different location or just &quot;Milwaukee, WI&quot;</li>
            <li>Searching again in a day — new jobs post every day</li>
          </ul>
        </div>
      )}

      {/* CareerOneStop attribution -- required by DOL API terms when their data is shown */}
      {source === "careeronestop" && visibleJobs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-muted">
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
          {visibleJobs.map((job) => {
            const isSaved = savedJobs.has(job.id);
            const savedStatus = savedJobs.get(job.id)?.status;
            const isExpanded = expandedJob === job.id;

            return (
              <div
                key={job.id}
                className="bg-white rounded-xl border border-border overflow-hidden transition-shadow hover:shadow-sm"
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
                        <h3 className="font-semibold text-foreground">
                          {job.title}
                        </h3>
                        {job.second_chance && (
                          <span className="text-[10px] font-medium bg-sage-100 text-sage-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Fair Chance
                          </span>
                        )}
                        {job.remote && (
                          <span className="text-[10px] font-medium bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Remote
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted">{job.company}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                        {job.location && <span>{job.location}</span>}
                        {job.salary && (
                          <span className="font-medium text-sage-600">
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
                      className={`text-muted flex-shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`}
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
                  <p className="text-sm text-muted mt-2 leading-relaxed line-clamp-2">
                    {job.description}
                  </p>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
                    {/* Company / salary / type meta row */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium text-foreground">{job.company}</span>
                      {job.salary && (
                        <span className="text-sage-600 font-medium">{job.salary}</span>
                      )}
                      {job.employment_type && (
                        <span className="text-muted">{job.employment_type}</span>
                      )}
                      {job.remote && <span className="text-sky-600 font-medium">Remote</span>}
                    </div>

                    {/* Full description */}
                    <div className="text-sm text-foreground leading-relaxed space-y-2">
                      {(job.full_description || job.description)
                        .split(/\n{2,}/)
                        .filter(Boolean)
                        .map((para, i) => (
                          <p key={i}>{para.trim()}</p>
                        ))}
                    </div>

                    {/* Fair chance reason */}
                    {job.fair_chance_reason && (
                      <div className="bg-sage-50 rounded-lg px-3 py-2 border border-sage-200">
                        <p className="text-xs font-medium text-sage-700">
                          Fair-chance employer -- {job.fair_chance_reason}
                        </p>
                      </div>
                    )}

                    {/* Requirements */}
                    {job.requirements.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-1.5 uppercase tracking-wide">
                          What they&apos;re looking for
                        </h4>
                        <ul className="text-sm text-muted space-y-1">
                          {job.requirements.map((r, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-sage-500 flex-shrink-0">
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
                        <h4 className="text-xs font-semibold text-foreground mb-1.5 uppercase tracking-wide">
                          Benefits
                        </h4>
                        <ul className="text-sm text-muted space-y-1">
                          {job.benefits.map((b, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-sage-500 flex-shrink-0">
                                &bull;
                              </span>
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Apply link */}
                    {(job.apply_url || job.employer_website) && (
                      <div className="bg-sky-50 rounded-lg px-3 py-2 border border-sky-200">
                        <p className="text-xs text-sky-700 mb-1">
                          Apply directly -- always confirm the posting is still open before you apply.
                        </p>
                        {job.apply_url && (
                          <a
                            href={job.apply_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-sky-600 underline underline-offset-2 hover:text-sky-700 break-all"
                          >
                            View full listing &amp; apply &#8599;
                          </a>
                        )}
                        {!job.apply_url && job.employer_website && (
                          <a
                            href={job.employer_website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-sky-600 underline underline-offset-2 hover:text-sky-700"
                          >
                            {job.employer_website} &#8599;
                          </a>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          sessionStorage.setItem("resume_target_job", JSON.stringify(job));
                          window.location.href = "/dashboard/resume-builder?from=job";
                        }}
                        className="px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 transition-colors"
                      >
                        Build a Resume for This Job
                      </button>
                      {!isSaved ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            saveJob(job);
                          }}
                          className="px-4 py-2 bg-sage-600 text-white text-sm font-medium rounded-lg hover:bg-sage-700 transition-colors"
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
                            className="px-4 py-2 bg-sage-600 text-white text-sm font-medium rounded-lg hover:bg-sage-700 transition-colors"
                          >
                            Mark Applied
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              unsaveJob(job.id);
                            }}
                            className="text-xs text-muted hover:text-foreground"
                          >
                            Unsave
                          </button>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-sage-600 bg-sage-100 px-3 py-1.5 rounded-full">
                          Applied
                        </span>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissJob(job.id);
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600 ml-auto"
                      >
                        Not for me
                      </button>
                    </div>
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
                className="text-xs text-muted hover:text-foreground underline underline-offset-2"
              >
                Show {hiddenCount} hidden job{hiddenCount !== 1 ? "s" : ""}
              </button>
            </div>
          )}

          <p className="text-xs text-muted text-center py-4">
            Listings sourced from real job boards. Updated daily.
            Always confirm details directly with the employer.
          </p>
        </div>
      )}

      {/* How it works — always visible at bottom */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          How This Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-warm-50 rounded-xl border border-warm-200">
            <span className="text-sm font-medium block">Real Listings</span>
            <span className="text-xs text-muted">
              Every job here is a real posting from employers hiring right now
              in your area.
            </span>
          </div>
          <div className="p-3 bg-warm-50 rounded-xl border border-warm-200">
            <span className="text-sm font-medium block">Fair Chance First</span>
            <span className="text-xs text-muted">
              Companies known to hire people with records are highlighted and
              shown first.
            </span>
          </div>
          <div className="p-3 bg-warm-50 rounded-xl border border-warm-200">
            <span className="text-sm font-medium block">Save &amp; Track</span>
            <span className="text-xs text-muted">
              Save jobs you like. Mark when you apply. Build your resume and
              practice interviews for each one.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
