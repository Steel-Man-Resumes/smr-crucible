"use client";

/**
 * Job Board — Refinery Tool 4
 *
 * Real listings from JSearch API. Fair-chance flagged.
 * Everything renders natively — no outbound links.
 * Save jobs to track applications across the Refinery.
 */

import { useState, useEffect, useRef, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { SearchFilters, activeSearchFilters, FILTER_LABELS } from "@/components/jobs/SearchFilters";
import { defaultJobSearchFilters, readJobSearchFilters, canonicalSearchFilters, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import type { EnrichedJob, JobSearchSummary } from "@/lib/job-search-types";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TierGate } from "@/components/TierGate";
import { GhostGuide } from "@crucible/consumer-ui";
import { getOpusMessage } from "@/lib/opus-messages";
import { useUserContext } from "@/lib/use-user-context";
import { trackProgress } from "@/lib/track-progress";
import { jobSourceForSave } from "@/lib/job-source";
import { JobFitChoices } from "@/components/JobFitChoices";
import { jobFitExclusion, type JobFitPreferences } from "@/lib/job-fit";

// ─── Types ──────────────────────────────────────────────────────────────────

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
  const ownerUid = useSession().data?.user?.id;
  const focus = useLaneFocus();
  const explicitLane = searchParams.get("laneId");
  const laneKey = explicitLane || (focus.loaded ? focus.laneId || "main" : null);
  const laneRef = useRef(laneKey); laneRef.current = laneKey;
  const [loadedLane, setLoadedLane] = useState<string | null>(null);
  const preferencesReady = !!laneKey && loadedLane === laneKey;
  const [filters, setFilters] = useState<JobSearchFilters>(defaultJobSearchFilters);
  const [summary, setSummary] = useState<JobSearchSummary | null>(null);
  const [preferencesError, setPreferencesError] = useState("");
  const [preferencesNotice, setPreferencesNotice] = useState("");
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [accountRevision, setAccountRevision] = useState(0);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceReload, setPreferenceReload] = useState(0);
  const searchController = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const submittedFilters = useRef("");
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
  const [jobFit, setJobFit] = useState<JobFitPreferences | null>(null);
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
  const [prioritizeRecordEvidence, setPrioritizeRecordEvidence] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [roleFromLane, setRoleFromLane] = useState(false);

  // Restore only this signed-in person's validated lane. A URL path choice
  // wins over the previous search; requests from a former lane are aborted.
  useEffect(() => {
    if (!ownerUid || !laneKey) return;
    const controller = new AbortController();
    searchController.current?.abort(); searchSequence.current++;
    setLoadedLane(null); setJobs([]); setSearched(false); setSummary(null); setSearching(false); setSavingPreferences(false);
    setPreferencesError(""); setPreferencesNotice(""); forgeLoadedRef.current = false; autoSearched.current = false;
    const requestedRole = searchParams.get("q"), requestedLocation = searchParams.get("location");
    fetch(`/api/job-search/preferences?laneId=${encodeURIComponent(laneKey)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Preferences unavailable"); return response.json(); })
      .then(data => {
        if (controller.signal.aborted || laneRef.current !== laneKey) return;
        let nextFilters = readJobSearchFilters(data.saved?.filters);
        let nextContext: UserContext = { targetRole: requestedRole || data.saved?.role || data.target || (focus.laneId === data.laneId ? focus.target : "") || "", location: requestedLocation || data.saved?.location || "", skills: [], hasRecord: false };
        try {
          const raw = sessionStorage.getItem(`job_search:v2:${ownerUid}:${laneKey}`);
          const cached = raw ? JSON.parse(raw) : null;
          if (!requestedRole && !requestedLocation && cached?.version === 2 && Date.now() - cached.ts < 6*60*60*1000 && Array.isArray(cached.jobs)) {
            nextFilters = readJobSearchFilters(cached.filters);
            nextContext = { ...nextContext, ...cached.context };
            setJobs(cached.jobs); setSummary(cached.summary || null); setFairChanceInfo(cached.fairChanceInfo || ""); setSource(cached.source || ""); setSearched(true);
            submittedFilters.current = canonicalSearchFilters(nextFilters);
          }
        } catch { setPreferencesNotice("Your last search could not be restored. Your saved lane choices are loaded."); }
        setFilters(nextFilters); setContext(nextContext); setPreferenceRevision(data.revision || 0); setAccountRevision(data.accountRevision || 0); setLoadedLane(laneKey);
      })
      .catch(() => { if (!controller.signal.aborted) setPreferencesError("Your lane search choices could not be loaded. Try again before searching."); });
    return () => { controller.abort(); searchController.current?.abort(); searchSequence.current++; };
  }, [ownerUid, laneKey, preferenceReload, searchParams]);

  async function rememberSearch(scope: "lane" | "account") {
    if (!laneKey || savingPreferences) return;
    const targetLane = laneKey;
    setSavingPreferences(true); setPreferencesNotice("");
    try {
      const response = await fetch("/api/job-search/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ laneId: targetLane, scope, revision: scope === "lane" ? preferenceRevision : accountRevision, role: context.targetRole, location: context.location, filters: readJobSearchFilters(filters) }) });
      const data = await response.json();
      if (laneRef.current !== targetLane) return;
      if (!response.ok) throw new Error(data.error || "Your choices did not save.");
      if (scope === "lane") setPreferenceRevision(data.saved.revision); else setAccountRevision(data.saved.revision);
      setPreferencesNotice(scope === "lane" ? "Search choices saved for this lane. Device location is not remembered." : "Account defaults saved. A lane’s own saved choices take priority. Device location is not remembered.");
    } catch (error) { if (laneRef.current === targetLane) setPreferencesNotice(error instanceof Error ? error.message : "Your choices did not save. Try again."); }
    finally { if (laneRef.current === targetLane) setSavingPreferences(false); }
  }

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
    if (!userContext || !preferencesReady || forgeLoadedRef.current) return;
    forgeLoadedRef.current = true;
    const f = userContext.forge;

    const role = !explicitLane || explicitLane === (focus.laneId || "main") ? focus.target || "" : "";
    setRoleFromLane(!!role);
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
  }, [userContext, preferencesReady, focus.target]);

  // Auto-search from URL param (e.g., ?q=Warehouse+Associate from dashboard CTA)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && preferencesReady && !autoSearched.current) {
      autoSearched.current = true;
      setContext((prev) => ({ ...prev, targetRole: q }));
    }
  }, [searchParams, preferencesReady]);

  // Trigger search when context is set from URL param
  useEffect(() => {
    if (preferencesReady && autoSearched.current && context.targetRole && !searched) {
      searchJobs();
    }
  }, [context.targetRole, preferencesReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions ────────────────────────────────────────────────────────────

  async function searchJobs() {
    if (!preferencesReady || !laneKey) return;
    let chosenFilters: JobSearchFilters;
    try { chosenFilters = readJobSearchFilters(filters); } catch (error) { setSearchError(error instanceof Error ? error.message : "Check your filters."); return; }
    const targetLane = laneKey;
    const request = ++searchSequence.current;
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    setSearching(true);
    setJobs([]);
    setSummary(null);
    setSearched(true);
    setRateLimitError("");
    setSearchError("");

    try {
      const res = await fetch("/api/job-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...context, filters: chosenFilters, laneId: targetLane }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;

      if (res.status === 429) {
        const data = await res.json();
        if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
        if (data.error) {
          // The job-data provider failed (quota/outage) -- say so plainly
          // instead of showing a misleading "no jobs found".
          setJobs([]);
          setSearchError(
            data.error === "location_required" ? "Add a city or ZIP. For a nationwide remote search, choose Remote and Anywhere."
              : data.error === "provider_rate_limited"
              ? "Our job-listing provider hit its limit for right now. This is on our side, not yours. Your search was fine. Try again in a little while."
              : "We couldn't reach the job listings just now. This is on our side, not yours. Try again in a few minutes."
          );
        } else {
          setJobs(data.jobs || []);
          setFairChanceInfo(data.fair_chance_info || "");
          setSource(data.source || "");
          setSummary(data.summary || null);
          submittedFilters.current = canonicalSearchFilters(chosenFilters);
          try { if (chosenFilters.origin) sessionStorage.removeItem(`job_search:v2:${ownerUid}:${targetLane}`); else sessionStorage.setItem(`job_search:v2:${ownerUid}:${targetLane}`, JSON.stringify({ version: 2, ts: Date.now(), context, filters: { ...chosenFilters, origin: null }, jobs: data.jobs || [], summary: data.summary ? { ...data.summary, filters: { ...data.summary.filters, origin: null } } : null, fairChanceInfo: data.fair_chance_info || "", source: data.source || "" })); } catch {}

        }
      } else {
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
        setJobs([]);
        setSearchError(data?.message || data?.error || "Something went wrong running that search. Try again.");
      }
    } catch {
      if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
      setJobs([]);
      setSearchError(
        "We couldn't reach the server. Check your connection and try again."
      );
    } finally {
      if (request === searchSequence.current && laneRef.current === targetLane) setSearching(false);
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
    const jobSource = jobSourceForSave(job.id, source);
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
          source: jobSource,
          source_id: job.id,
          apply_url: job.apply_url || null,
          employer_website: job.employer_website || null,
          // Phase 3.2: persist the fuller JD (full_description retains up to 20,000 characters of the
          // HTML-stripped body) so the saved snapshot is not the 200-char
          // truncated `description`. Provenance = the board provider + apply URL.
          jdFullText: job.full_description || job.description,
          jdSourceProvider: jobSource,
          jdSourceUrl: job.apply_url || job.employer_website || null,
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

  const visibleJobs = (preferencesReady ? jobs : []).filter((j) => {
    if (!jobFit || jobFitExclusion(j, jobFit)) return false;
    if (hiddenJobs.has(j.id)) return false;
    if (hiddenEmployerKeys.has(lightEmployerKey(j.company))) return false;
    if (remoteOnly && !j.remote) return false;
    return true;
  });
  if (prioritizeRecordEvidence) visibleJobs.sort((a, b) => Number(b.second_chance) - Number(a.second_chance));
  const hiddenCount = jobs.length - visibleJobs.length;
  const savedCount = savedJobs.size;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">
        Job Board
      </h1>
      <GhostGuide message={getOpusMessage("jobs")} pageId="jobs" />
      <p className="text-base text-t-phos-dim mb-6">
        Job listings from connected providers. Posting dates and available details vary. Employers we checked for hiring people with records are marked.
        Everything stays right here in your dashboard.
      </p>

      {/* Cross-link into the curated job paths (completes the loop) */}
      <Link
        href="/dashboard/paths"
        className="t-focus flex items-center justify-between gap-3 bg-t-panel border border-t-line px-4 py-3 mb-6 hover:border-t-phos-dim transition-colors"
      >
        <span className="text-sm text-t-phos">
          <span className="font-semibold text-t-white">Not sure where to start?</span>{" "}
          Explore work paths, the evidence you already have, and what you would need next.
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
            <Link href="/dashboard/applications" className="text-xs text-t-amber-bright underline">
              Track applications
            </Link>
          </div>
        </div>
      )}

      {/* Search form */}
      <JobFitChoices onChange={setJobFit} />
      {preferencesError && <p role="alert" className="mb-4 border border-t-red p-3 text-sm text-t-red">{preferencesError} <button type="button" onClick={() => setPreferenceReload(n=>n+1)} className="t-focus min-h-touch underline">Retry</button></p>}
      {!preferencesReady && !preferencesError && <p role="status" className="mb-4 text-sm text-t-phos-dim">Loading this lane’s search choices...</p>}
      <div className="bg-t-panel p-5 border border-t-line mb-6" aria-busy={!preferencesReady}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              What kind of work?
            </label>
            <input
              disabled={!preferencesReady}
              aria-label="What kind of work?"
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
              You can combine terms. Try &quot;Forklift, Warehouse&quot; or &quot;CNA, Medical&quot;.
            </p>
            {roleFromLane && context.targetRole && (
              <p className="text-xs text-t-amber-bright mt-1">
                From this lane’s goal. Edit it anytime.
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
              disabled={!preferencesReady}
              aria-label="Search city or ZIP"
              value={context.location}
              onChange={(e) =>
                { setContext({ ...context, location: e.target.value }); setFilters(f=>({...f,origin:null})); }
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder="City, State (e.g., Milwaukee, WI)"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
            />
          </div>

          <SearchFilters key={laneKey || "loading"} value={filters} onChange={setFilters} disabled={!preferencesReady || searching} />
          <div className="flex flex-wrap gap-2" aria-label="Active search choices">{activeSearchFilters(filters).map(line=><span key={line} className="border border-t-line px-2 py-1 text-xs text-t-phos-dim">{line}</span>)}</div>
          <div className="flex flex-wrap gap-3 text-xs"><button type="button" disabled={!preferencesReady || savingPreferences} onClick={()=>void rememberSearch("lane")} className="t-focus min-h-touch text-t-amber-bright underline">Remember for this lane</button><button type="button" disabled={!preferencesReady || savingPreferences} onClick={()=>void rememberSearch("account")} className="t-focus min-h-touch text-t-phos-dim underline">Use as account defaults</button></div>
          {preferencesNotice && <p role="status" className="text-xs text-t-phos-dim">{preferencesNotice}</p>}
          <button
            onClick={searchJobs}
            disabled={!preferencesReady || searching || (!context.targetRole && !context.location)}
            data-tour="jobs-search-button"
            className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
          >
            {searching ? "Searching real listings..." : "Find Jobs"}
          </button>
        </div>
      </div>

      {summary && !searching && preferencesReady && <section aria-label="Loaded search results" className="mb-4 border border-t-line bg-t-panel p-4 text-sm text-t-phos-dim"><p>{summary.matched} kept from {summary.loaded} loaded listings. {summary.excluded} excluded. {summary.unknownIncluded} kept with fields to check.</p><p className="mt-1 text-xs">This is a bounded search, not a count of every opening. Listings fetched {new Date(summary.fetchedAt).toLocaleString()}. {source === "cache" ? "Reused from a cached search." : ""}</p>{summary.notices.map(line=><p key={line} className="mt-1 text-xs">{line}</p>)}{submittedFilters.current !== canonicalSearchFilters(filters) && <p className="mt-2 text-xs text-t-amber-bright">Choices changed. Run Find Jobs to apply them.</p>}</section>}
      {prioritizeRecordEvidence && <p className="mb-3 text-sm text-t-phos-dim">Employers with verified evidence appear first. Other openings stay visible: missing evidence does not mean an employer won’t hire you.</p>}
      {summary && summary.excluded > 0 && <details className="mb-4 text-sm text-t-phos-dim"><summary className="cursor-pointer">Why were openings excluded?</summary><ul className="mt-2 space-y-1">{Object.entries(summary.excludedBy).map(([key, count]) => <li key={key}>{key === "personal" ? "Your saved exclusions or hidden employers" : key.startsWith("unknown_") ? `Missing ${FILTER_LABELS[key.slice(8)] || key.slice(8)}` : FILTER_LABELS[key] || key}: {count}</li>)}</ul><p className="mt-2">One opening can fail more than one requirement. Change a requirement only if it works for you, then run Find Jobs again.</p></details>}
      {/* Phase 4C: result filters -- refine the listings you already pulled */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-medium text-t-phos-dim">Show:</span>
          <button
            aria-pressed={prioritizeRecordEvidence}
            title="Bring employers with verified hiring evidence to the top. Other openings stay visible because missing evidence is not a refusal."
            onClick={() => setPrioritizeRecordEvidence((v) => !v)}
            className={`t-focus text-xs px-3 py-1.5 border transition-colors ${prioritizeRecordEvidence ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            Prioritize employers with hiring evidence
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

      {/* Applying-with-a-record info box (AI-written general guidance, not a checked list) */}
      {fairChanceInfo && (
        <div className="bg-t-panel p-5 border border-t-steel mb-6">
          <h2 className="font-semibold text-t-steel mb-2">
            Applying With a Record Here
          </h2>
          <p className="text-sm text-t-phos leading-relaxed">
            {fairChanceInfo}
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
            General guidance, not a list of employers we checked.
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
            No listings kept from this loaded search. You can change a choice and search again:
          </p>
          <ul className="text-sm text-t-phos-dim space-y-1">
            {summary && Object.entries(summary.excludedBy).map(([key,count])=><li key={key}>{key.startsWith("unknown_") ? `Not supplied: ${FILTER_LABELS[key.slice(8)] || key.slice(8)}` : FILTER_LABELS[key] || key}: {count} loaded listing{count===1?"":"s"}. Reasons can overlap.</li>)}
            <li>Adjust the role, distance or a must-have filter above. Your radius is never widened automatically.</li>
            {!filters.includeUnknown && <li>Allow unknown fields if you want to inspect listings with missing details.</li>}
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
                {job.filterAssessment && <div className="border-b border-t-line px-4 py-2 text-xs text-t-phos-dim">{job.filterAssessment.distanceMiles === null ? "Distance unverified" : `About ${job.filterAssessment.distanceMiles.toFixed(1)} miles in a straight line`}{job.filterAssessment.unknown.length>0?` · Check: ${job.filterAssessment.unknown.map(key=>FILTER_LABELS[key]||key).join(", ")}`:""}{job.filterAssessment.preferred.length>0?` · Preferences not matched: ${job.filterAssessment.preferred.map(key=>FILTER_LABELS[key]||key).join(", ")}`:""}</div>}
                {job.evidence && <p className="px-4 pt-2 text-xs text-t-phos-dim">Source: {job.evidence.source}. Posted: {job.evidence.postedAt && Number.isFinite(Date.parse(job.evidence.postedAt)) ? new Date(job.evidence.postedAt).toLocaleDateString() : "not supplied"}. Fetched: {new Date(job.evidence.fetchedAt).toLocaleString()}.</p>}
                {job.evidence?.warnings.map(warning=><p key={warning} className="px-4 pt-1 text-xs text-t-amber-bright">{warning}</p>)}
                {job.relevance && <p className="px-4 pt-2 text-sm text-t-phos-dim">{job.relevance.reason}</p>}
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
                            Hires people with records
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

                    {/* Why this listing carries the mark */}
                    {job.fair_chance_reason && (
                      <div className="bg-t-panel-2 px-3 py-2 border border-t-amber">
                        <p className="text-xs font-medium text-t-amber-bright">
                          {job.fair_chance_reason}
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
                          placeholder="Reason (optional), like a former employer or already applied"
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
            <span className="text-sm font-medium text-t-white block">Checked Employers First</span>
            <span className="text-xs text-t-phos-dim">
              Employers we checked for hiring people with records are marked
              and shown first. The mark only shows where we checked.
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
