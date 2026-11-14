"use client";

/**
 * Job Board — Refinery Tool 4
 *
 * Real listings from JSearch API. Fair-chance flagged.
 * Everything renders natively — no outbound links.
 * Save jobs to track applications across the Refinery.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { useState, useEffect, useRef, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { SearchFilters, activeSearchFiltersLocalized, FILTER_LABELS } from "@/components/jobs/SearchFilters";
import { defaultJobSearchFilters, readJobSearchFilters, canonicalSearchFilters, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import type { EnrichedJob, JobSearchSummary } from "@/lib/job-search-types";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { TierGate } from "@/components/TierGate";
import { GhostGuide } from "@crucible/consumer-ui";
import { getOpusMessage } from "@/lib/opus-messages";
import { useUserContext } from "@/lib/use-user-context";
import { trackProgress } from "@/lib/track-progress";
import { jobSourceForSave } from "@/lib/job-source";
import { JobFitChoices } from "@/components/JobFitChoices";
import { jobFitExclusion, type JobFitPreferences } from "@/lib/job-fit";
import { broadenJobSearch } from "@/lib/job-search-broaden";
import { BATCH_HANDOFF_KEY, MAX_BATCH_JOBS, toggleSelection, type BatchJob } from "@/lib/tailor-batch";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SavedJob {
  id: string;
  status: "saved" | "applied" | "heard_back" | "interviewing" | "offered";
}

/** A saved application row, as much as multi-job tailoring needs. */
interface SavedRow {
  id: string; job_title: string; company: string; status: string; source_id?: string | null; source?: string | null;
  location?: string | null; salary?: string | null; employment_type?: string | null; description?: string | null;
  jd_full_text?: string | null; apply_url?: string | null; employer_website?: string | null; resume_artifact_id?: string | null;
}

function batchJobFromSaved(row: SavedRow): BatchJob {
  return {
    selectKey: row.source_id || row.id, title: row.job_title, company: row.company, location: row.location || "",
    salary: row.salary || null, employment_type: row.employment_type || "", description: row.jd_full_text || row.description || "",
    id: row.source_id || undefined, apply_url: row.apply_url || null, employer_website: row.employer_website || null,
    source: row.source || "jsearch", existingApplicationId: row.id,
  };
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
  const t = useTranslations("refineryJobs.jobsPage");
  const tc = useTranslations("common.actions");
  const locale = useLocale();
  const tFilters = useTranslations("refineryJobs.searchFilters");
  const filterLabel = (key: string) => (FILTER_LABELS[key] ? t(`filterLabels.${key}`) : key);
  const searchParams = useSearchParams();
  const ownerUid = useSession().data?.user?.id;
  const ownerRef = useRef(ownerUid); ownerRef.current = ownerUid;
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
  const [preferenceSource, setPreferenceSource] = useState("built-in");
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
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  // Multi-job tailoring: up to three picks from results or saved jobs, in pick order.
  const [picked, setPicked] = useState<BatchJob[]>([]);
  const [pickNotice, setPickNotice] = useState("");
  const [hiddenJobs, setHiddenJobs] = useState<Set<string>>(new Set());
  // N1: persistent per-employer hiding (normalized name keys) + the card being confirmed.
  const [hiddenEmployers, setHiddenEmployers] = useState<Array<{ id: string; display_name: string }>>([]);
  const hiddenEmployerKeys = new Set(hiddenEmployers.map(employer => lightEmployerKey(employer.display_name)));
  const [hiddenEmployerError, setHiddenEmployerError] = useState("");
  const [restoringEmployer, setRestoringEmployer] = useState<string | null>(null);
  const [hiddenReload, setHiddenReload] = useState(0);
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
          const raw = sessionStorage.getItem(`job_search:v3:${ownerUid}:${laneKey}`);
          const cached = raw ? JSON.parse(raw) : null;
          if (!requestedRole && !requestedLocation && cached?.version === 3 && Date.now() - cached.ts < 6*60*60*1000 && Array.isArray(cached.jobs)) {
            nextFilters = readJobSearchFilters(cached.filters);
            nextContext = { ...nextContext, ...cached.context };
            setJobs(cached.jobs); setSummary(cached.summary || null); setFairChanceInfo(cached.fairChanceInfo || ""); setSource(cached.source || ""); setSearched(true);
            submittedFilters.current = canonicalSearchFilters(nextFilters);
          }
        } catch { setPreferencesNotice(t("restoreFailed")); }
        setPreferenceSource(data.source === "lane" ? "lane" : data.source === "account" ? "account" : "built-in");
        setFilters(nextFilters); setContext(nextContext); setPreferenceRevision(data.revision || 0); setAccountRevision(data.accountRevision || 0); setLoadedLane(laneKey);
      })
      .catch(() => { if (!controller.signal.aborted) setPreferencesError(t("lanePrefsFailed")); });
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
      if (!response.ok) throw new Error(data.error || t("choicesNotSaved"));
      if (scope === "lane") setPreferenceRevision(data.saved.revision); else setAccountRevision(data.saved.revision);
      setPreferencesNotice(scope === "lane" ? t("savedForLane") : t("savedAsDefaults"));
    } catch (error) { if (laneRef.current === targetLane) setPreferencesNotice(error instanceof Error ? error.message : t("choicesNotSavedRetry")); }
    finally { if (laneRef.current === targetLane) setSavingPreferences(false); }
  }

  // Shared browsers never reuse another account's hidden or saved job state.
  useEffect(() => {
    const controller = new AbortController();
    setHiddenEmployers([]); setSavedJobs(new Map()); setHiddenJobs(new Set()); setSavedRows([]); setPicked([]); setPickNotice("");
    setHiddenEmployerError(""); setRestoringEmployer(null);
    if (!ownerUid) return () => controller.abort();
    try {
      const stored = JSON.parse(localStorage.getItem(`hidden_jobs:v2:${ownerUid}`) || "[]");
      if (Array.isArray(stored)) setHiddenJobs(new Set(stored.filter((id): id is string => typeof id === "string")));
    } catch {}
    void fetch("/api/user/hidden-employers", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(body => {
        if (controller.signal.aborted) return;
        setHiddenEmployers(Array.isArray(body.employers) ? body.employers.filter((item: {id?: unknown; display_name?: unknown}) => typeof item?.id === "string" && typeof item?.display_name === "string") : []);
      }).catch(() => { if (!controller.signal.aborted) setHiddenEmployerError(t("hiddenLoadFailed")); });
    void fetch("/api/applications", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(body => {
        if (controller.signal.aborted) return;
        const map = new Map<string, SavedJob>();
        for (const app of body.applications || []) map.set(app.source_id || app.id, { id: app.id, status: app.status });
        setSavedJobs(map);
        setSavedRows((body.applications || []).filter((app: SavedRow) => typeof app?.id === "string" && typeof app?.job_title === "string" && typeof app?.company === "string"));
      }).catch(() => {});
    return () => controller.abort();
  }, [ownerUid, hiddenReload]);

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

  // URL suggestions fill the form; the person reviews the visible choices before searching.

  // ─── Actions ────────────────────────────────────────────────────────────

  async function searchJobs(override?: JobSearchFilters) {
    if (!preferencesReady || !laneKey) return;
    let chosenFilters: JobSearchFilters;
    try { chosenFilters = readJobSearchFilters(override ?? filters); } catch (error) { setSearchError(error instanceof Error ? error.message : t("checkFilters")); return; }
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
          // Keep the counts: listings the person's own choices removed are
          // shown next to the outage line, not hidden behind it.
          setSummary(data.summary || null);
          setSearchError(
            data.error === "location_required" ? t("errLocationRequired")
              : data.error === "provider_partial"
              ? t("errProviderPartial")
              : data.error === "provider_rate_limited"
              ? t("errProviderRateLimited")
              : t("errProviderDown")
          );
        } else {
          setJobs(data.jobs || []);
          setFairChanceInfo(data.fair_chance_info || "");
          setSource(data.source || "");
          setSummary(data.summary || null);
          submittedFilters.current = canonicalSearchFilters(chosenFilters);
          try { if (chosenFilters.origin) sessionStorage.removeItem(`job_search:v3:${ownerUid}:${targetLane}`); else sessionStorage.setItem(`job_search:v3:${ownerUid}:${targetLane}`, JSON.stringify({ version: 3, ts: Date.now(), context, filters: { ...chosenFilters, origin: null }, jobs: data.jobs || [], summary: data.summary ? { ...data.summary, filters: { ...data.summary.filters, origin: null } } : null, fairChanceInfo: data.fair_chance_info || "", source: data.source || "" })); } catch {}

        }
      } else {
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
        setJobs([]);
        setSearchError(data?.message || data?.error || t("errSearchGeneric"));
      }
    } catch {
      if (controller.signal.aborted || request !== searchSequence.current || laneRef.current !== targetLane) return;
      setJobs([]);
      setSearchError(
        t("errServer")
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

  function togglePick(job: BatchJob) {
    const keys = picked.map(item => item.selectKey);
    const result = toggleSelection(keys, job.selectKey, MAX_BATCH_JOBS);
    if (result.refused) { setPickNotice(t("pickFull")); return; }
    setPickNotice("");
    setPicked(previous => result.selected.map(key => previous.find(item => item.selectKey === key) || job));
  }

  function batchJobFromResult(job: EnrichedJob): BatchJob {
    return {
      selectKey: job.id, title: job.title, company: job.company, location: job.location, salary: job.salary,
      employment_type: job.employment_type, description: job.full_description || job.description,
      requirements: job.requirements, id: job.id, apply_url: job.apply_url || null,
      employer_website: job.employer_website || null, source: jobSourceForSave(job.id, source),
    };
  }

  function tailorPicked() {
    if (!ownerUid || picked.length === 0) return;
    try {
      sessionStorage.setItem(BATCH_HANDOFF_KEY, JSON.stringify({ ownerUid, laneId: laneKey && laneKey !== "main" ? laneKey : null, jobs: picked }));
    } catch { setPickNotice(t("pickStorageFailed")); return; }
    window.location.href = "/dashboard/application-tailor?from=batch";
  }

  function dismissJob(jobId: string) {
    setHiddenJobs((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      try { if (ownerUid) localStorage.setItem(`hidden_jobs:v2:${ownerUid}`, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  async function hideEmployer(company: string) {
    const name = (company || "").trim();
    if (!name || !ownerUid) return;
    const owner = ownerUid;
    setHiddenEmployerError("");
    try {
      const response = await fetch("/api/user/hidden-employers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reason: hideReason.trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.employer?.id !== "string" || typeof body.employer?.display_name !== "string") throw new Error();
      if (ownerRef.current !== owner) return;
      setHiddenEmployers(previous => [...previous.filter(item => item.id !== body.employer.id), body.employer]);
      setHideEmployerFor(null); setHideReason("");
    } catch { if (ownerRef.current === owner) setHiddenEmployerError(t("hideFailed")); }
  }

  async function restoreEmployer(id: string) {
    if (restoringEmployer || !ownerUid) return;
    const owner = ownerUid;
    setRestoringEmployer(id); setHiddenEmployerError("");
    try {
      const response = await fetch("/api/user/hidden-employers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error();
      if (ownerRef.current !== owner) return;
      setHiddenEmployers(previous => previous.filter(item => item.id !== id));
      setPreferencesNotice(t("employerRestored"));
    } catch { if (ownerRef.current === owner) setHiddenEmployerError(t("restoreEmployerFailed")); }
    finally { if (ownerRef.current === owner) setRestoringEmployer(null); }
  }

  function showDismissedJobs() {
    setHiddenJobs(new Set());
    try { if (ownerUid) localStorage.removeItem(`hidden_jobs:v2:${ownerUid}`); } catch {}
  }

  function showBroaderResults() {
    const broader = broadenJobSearch(filters);
    setFilters(broader); setRemoteOnly(false); showDismissedJobs();
    setPreferencesNotice(t("broaderNotice"));
    void searchJobs(broader);
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
  const dismissedCount = jobs.filter(job => hiddenJobs.has(job.id)).length;
  const savedCount = savedJobs.size;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-t-white mb-2">
        {t("title")}
      </h1>
      <GhostGuide message={getOpusMessage("jobs", "client", false, locale)} pageId="jobs" />
      <p className="text-base text-t-phos-dim mb-6">
        {t("intro")}
      </p>

      {/* Cross-link into the curated job paths (completes the loop) */}
      <Link
        href="/dashboard/paths"
        className="t-focus flex items-center justify-between gap-3 bg-t-panel border border-t-line px-4 py-3 mb-6 hover:border-t-phos-dim transition-colors"
      >
        <span className="text-sm text-t-phos">
          <span className="font-semibold text-t-white">{t("crossTitle")}</span>{" "}
          {t("crossBody")}
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
                {t("savedCount",{count:savedCount})}
              </span>
              <span className="text-xs text-t-phos-dim ml-2">
                {t("appliedCount",{count:Array.from(savedJobs.values()).filter(
                  (j) => j.status === "applied"
                ).length})}
              </span>
            </div>
            <Link href="/dashboard/applications" className="text-xs text-t-amber-bright underline">
              {t("trackApplications")}
            </Link>
          </div>
          {savedRows.some(row => row.status === "saved") && (
            <details className="mt-3 text-sm text-t-phos" data-testid="saved-jobs-picker">
              <summary className="t-focus min-h-touch cursor-pointer text-t-white">{t("pickSaved",{max:MAX_BATCH_JOBS})}</summary>
              <ul className="mt-2 space-y-1">
                {savedRows.filter(row => row.status === "saved").slice(0, 20).map(row => {
                  const item = batchJobFromSaved(row);
                  const isPicked = picked.some(p => p.selectKey === item.selectKey);
                  return (
                    <li key={row.id}>
                      <label className="flex min-h-touch items-center gap-3">
                        <input type="checkbox" className="h-5 w-5 flex-shrink-0" checked={isPicked} onChange={() => togglePick(item)} />
                        <span>{t("jobAt",{title:row.job_title,company:row.company})}{row.resume_artifact_id ? <span className="text-xs text-t-phos-dim"> · {t("hasTailored")}</span> : null}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Search form */}
      <div id="job-fit-choices"><JobFitChoices key={ownerUid || "signed-out"} onChange={setJobFit} /></div>
      {preferencesError && <p role="alert" className="mb-4 border border-t-red p-3 text-sm text-t-red">{preferencesError} <button type="button" onClick={() => setPreferenceReload(n=>n+1)} className="t-focus min-h-touch underline">{t("retry")}</button></p>}
      {!preferencesReady && !preferencesError && <p role="status" className="mb-4 text-sm text-t-phos-dim">{t("loadingLane")}</p>}
      <div id="refinery-tool-jobs-search" role="group" aria-label={t("choicesAria")} className="bg-t-panel p-5 border border-t-line mb-6" aria-busy={!preferencesReady}>
        <div className="space-y-4">
          <div id="refinery-tool-jobs-query">
            <label className="text-sm font-medium text-t-white block mb-1">
              {t("kindOfWork")}
            </label>
            <input
              disabled={!preferencesReady}
              aria-label={t("kindOfWork")}
              value={context.targetRole}
              onChange={(e) =>
                setContext({ ...context, targetRole: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder={t("workPlaceholder")}
              data-tour="jobs-search-role"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
            />
            <p className="text-xs text-t-phos-dim mt-1">
              {t("combineTerms")}
            </p>
            {roleFromLane && context.targetRole && (
              <p className="text-xs text-t-amber-bright mt-1">
                {t("fromLaneGoal")}
              </p>
            )}
            {/* Quick picks — click to set or append */}
            <div className="flex flex-wrap gap-2 mt-2">
              {COMMON_ROLES.slice(0, 6).map((role, roleIndex) => {
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
                    {t(`roles.${roleIndex}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-t-white block mb-1">{t("where")}</label>
            <input
              disabled={!preferencesReady}
              aria-label={t("cityOrZip")}
              value={context.location}
              onChange={(e) =>
                { setContext({ ...context, location: e.target.value }); setFilters(f=>({...f,origin:null})); }
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && (context.targetRole || context.location)) searchJobs();
              }}
              placeholder={t("cityPlaceholder")}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
            />
          </div>

          <p className="mb-3 text-sm text-t-phos">{preferenceSource === "built-in" ? t("sourceBuiltIn") : preferenceSource === "lane" ? t("sourceLane") : t("sourceAccount")}</p>
          <SearchFilters key={laneKey || "loading"} value={filters} onChange={setFilters} disabled={!preferencesReady || searching} />
          <div className="flex flex-wrap gap-2" aria-label={t("activeAria")}>{activeSearchFiltersLocalized(filters, tFilters).map(line=><span key={line} className="border border-t-line px-2 py-1 text-xs text-t-phos-dim">{line}</span>)}</div>
          <div className="flex flex-wrap gap-3 text-xs"><button type="button" disabled={!preferencesReady || savingPreferences} onClick={()=>void rememberSearch("lane")} className="t-focus min-h-touch text-t-amber-bright underline">{t("rememberLane")}</button><button type="button" disabled={!preferencesReady || savingPreferences} onClick={()=>void rememberSearch("account")} className="t-focus min-h-touch text-t-phos-dim underline">{t("useDefaults")}</button></div>
          {preferencesNotice && <p role="status" className="text-xs text-t-phos-dim">{preferencesNotice}</p>}
          <button
            onClick={() => void searchJobs()}
            disabled={!preferencesReady || searching || (!context.targetRole && !context.location)}
            data-tour="jobs-search-button"
            className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
          >
            {searching ? t("searchingListings") : t("findJobs")}
          </button>
        </div>
      </div>

      <section aria-label={t("broadenAria")} className="mb-4 border border-t-line bg-t-panel p-4 text-sm text-t-phos">
        <p>{t("broadenIntro")}</p>
        <button type="button" disabled={!preferencesReady || searching || (!context.targetRole && !context.location)} onClick={showBroaderResults} className="t-focus mt-3 min-h-touch border border-t-line px-4">{t("showBroader")}</button>
        <p className="mt-3 text-xs">{t.rich("undoExclusions",{link:(chunks) => <a href="#job-fit-choices" className="underline">{chunks}</a>})}</p>
        {dismissedCount > 0 && <button type="button" onClick={showDismissedJobs} className="t-focus mt-3 min-h-touch underline">{t("showDismissed",{count:dismissedCount})}</button>}
        <details className="mt-3"><summary className="t-focus min-h-touch cursor-pointer">{t("reviewHidden",{count:hiddenEmployers.length})}</summary>
          {hiddenEmployers.length === 0 && !hiddenEmployerError && <p>{t("noHidden")}</p>}
          <ul>{hiddenEmployers.map(employer => <li key={employer.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{employer.display_name}</span><button type="button" disabled={restoringEmployer !== null} onClick={() => void restoreEmployer(employer.id)} className="t-focus min-h-touch underline">{restoringEmployer === employer.id ? t("restoring") : t("showEmployerJobs")}</button></li>)}</ul>
        </details>
        {hiddenEmployerError && <p role="alert">{hiddenEmployerError} <button type="button" onClick={() => setHiddenReload(value => value + 1)} className="t-focus min-h-touch underline">{t("reloadHidden")}</button></p>}
      </section>
      {summary && !searching && preferencesReady && <section aria-label={t("resultsAria")} className="mb-4 border border-t-line bg-t-panel p-4 text-sm text-t-phos-dim"><p>{t("summaryCounts",{matched:summary.matched,loaded:summary.loaded,excluded:summary.excluded,unknown:summary.unknownIncluded})}</p><p className="mt-1 text-xs">{t("bounded",{time:new Date(summary.fetchedAt).toLocaleString()})} {source === "cache" ? t("cached") : ""}</p>{summary.notices.map(line=><p key={line} className="mt-1 text-xs">{line}</p>)}{submittedFilters.current !== canonicalSearchFilters(filters) && <p className="mt-2 text-xs text-t-amber-bright">{t("choicesChanged")}</p>}</section>}
      {prioritizeRecordEvidence && <p className="mb-3 text-sm text-t-phos-dim">{t("prioritizeNote")}</p>}
      {summary && summary.excluded > 0 && <details className="mb-4 text-sm text-t-phos-dim"><summary className="cursor-pointer">{t("whyExcluded")}</summary><ul className="mt-2 space-y-1">{Object.entries(summary.excludedBy).map(([key, count]) => <li key={key}>{key === "personal" ? t("excludedPersonal") : key.startsWith("unknown_") ? t("missingField",{label:filterLabel(key.slice(8))}) : filterLabel(key)}: {count}</li>)}</ul><p className="mt-2">{t("excludedNote")}</p></details>}
      {/* Phase 4C: result filters -- refine the listings you already pulled */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs font-medium text-t-phos-dim">{t("show")}</span>
          <button
            aria-pressed={prioritizeRecordEvidence}
            title={t("prioritizeTitle")}
            onClick={() => setPrioritizeRecordEvidence((v) => !v)}
            className={`t-focus text-xs px-3 py-1.5 border transition-colors ${prioritizeRecordEvidence ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            {t("prioritize")}
          </button>
          <button
            onClick={() => setRemoteOnly((v) => !v)}
            className={`t-focus text-xs px-3 py-1.5 border transition-colors ${remoteOnly ? "bg-t-steel text-white border-t-steel font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            {t("remoteOnly")}
          </button>
          <span className="text-xs text-t-phos-dim ml-auto">
            {t("shown",{visible:visibleJobs.length,total:jobs.length})}
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
            {t("searchTrouble")}
          </p>
          <p className="text-sm text-t-phos leading-relaxed">{searchError}</p>
          {summary && (summary.removedByChoices || 0) > 0 && <p className="mt-2 text-sm text-t-phos" data-testid="jobs-removed-by-choices">{t("removedByChoices",{count:summary.removedByChoices || 0})}</p>}
        </div>
      )}

      {/* Applying-with-a-record info box (AI-written general guidance, not a checked list) */}
      {fairChanceInfo && (
        <div className="bg-t-panel p-5 border border-t-steel mb-6">
          <h2 className="font-semibold text-t-steel mb-2">
            {t("applyingTitle")}
          </h2>
          <p className="text-sm text-t-phos leading-relaxed">
            {fairChanceInfo}
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
            {t("generalGuidance")}
          </p>
        </div>
      )}

      {/* Loading */}
      {searching && (
        <div className="flex items-center gap-3 py-12 justify-center text-t-phos-dim">
          <TroyWork compact decorative />
          {t("searchingJobs")}
        </div>
      )}

      {/* No results */}
      {!searching && searched && !searchError && visibleJobs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-t-phos-dim mb-3">
            {t("noneKept")}
          </p>
          <ul className="text-sm text-t-phos-dim space-y-1">
            {summary && Object.entries(summary.excludedBy).map(([key,count])=><li key={key}>{key.startsWith("unknown_") ? t("notSupplied",{label:filterLabel(key.slice(8))}) : filterLabel(key)}: {t("loadedListings",{count})}</li>)}
            <li>{t("adjustTip")}</li>
            {!filters.includeUnknown && <li>{t("allowUnknownTip")}</li>}
          </ul>
        </div>
      )}

      {/* CareerOneStop attribution -- required by DOL API terms when their data is shown */}
      {source === "careeronestop" && visibleJobs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-t-phos-dim">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cos-logo-star.svg" alt="CareerOneStop" className="h-5 w-auto" />
          <span>
            {t("careerOneStop")}
          </span>
        </div>
      )}

      {/* Results */}
      {!searching && visibleJobs.length > 0 && (
        <div className="space-y-3">
          {[visibleJobs.filter(j => j.relevance?.tier !== "description"), visibleJobs.filter(j => j.relevance?.tier === "description")].map((group, groupIndex) => {
            const cards = group.map((job, jobIndex) => {
            const isSaved = savedJobs.has(job.id);
            const savedStatus = savedJobs.get(job.id)?.status;
            const isExpanded = expandedJob === job.id;

            return (
              <div
                key={job.id}
                data-tour={groupIndex === 0 && jobIndex === 0 ? "jobs-first-result" : undefined}
                className="bg-t-panel border border-t-line overflow-hidden transition-colors hover:border-t-phos-dim"
              >
                {job.filterAssessment && <div className="border-b border-t-line px-4 py-2 text-xs text-t-phos-dim">{job.filterAssessment.distanceMiles === null ? t("distanceUnverified") : t("aboutMiles",{miles:job.filterAssessment.distanceMiles.toFixed(1)})}{job.filterAssessment.unknown.length>0?` · ${t("check",{list:job.filterAssessment.unknown.map(key=>filterLabel(key)).join(", ")})}`:""}{job.filterAssessment.preferred.length>0?` · ${t("preferencesNotMatched",{list:job.filterAssessment.preferred.map(key=>filterLabel(key)).join(", ")})}`:""}</div>}
                {job.evidence && <p className="px-4 pt-2 text-xs text-t-phos-dim">{t("evidenceLine",{source:job.evidence.source,posted:job.evidence.postedAt && Number.isFinite(Date.parse(job.evidence.postedAt)) ? new Date(job.evidence.postedAt).toLocaleDateString() : t("postedNotSupplied"),fetched:new Date(job.evidence.fetchedAt).toLocaleString()})}</p>}
                {job.evidence?.warnings.map(warning=><p key={warning} className="px-4 pt-1 text-xs text-t-amber-bright">{warning}</p>)}
                {job.relevance && <p className="px-4 pt-2 text-sm text-t-phos-dim">{job.relevance.reason}</p>}
                <label className="flex min-h-touch items-center gap-3 px-4 pt-2 text-sm text-t-phos" data-testid="job-pick">
                  <input
                    type="checkbox"
                    className="h-5 w-5 flex-shrink-0"
                    checked={picked.some(item => item.selectKey === job.id)}
                    onChange={() => togglePick(batchJobFromResult(job))}
                    aria-label={t("pickAria",{title:job.title,company:job.company})}
                  />
                  {t("pickLabel")}
                </label>
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
                            {t("hiresRecords")}
                          </span>
                        )}
                        {!job.second_chance && job.marked_elsewhere && (
                          <span data-testid="job-marked-elsewhere" className="text-[10px] font-medium border border-t-amber text-t-amber-bright px-2 py-0.5">
                            {t("hiresRecordsIn",{town:job.marked_elsewhere.town})}
                          </span>
                        )}
                        {job.remote && (
                          <span className="text-[10px] font-medium border border-t-steel text-t-steel px-2 py-0.5 whitespace-nowrap">
                            {t("remote")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-t-phos-dim">{job.company}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-t-phos-dim flex-wrap">
                        {job.location && <span>{job.location}</span>}
                        {job.other_locations && job.other_locations.length > 0 && <span data-testid="job-location-count">{t("locations",{count:job.other_locations.length + 1})}</span>}
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
                      {job.remote && <span className="text-t-steel font-medium">{t("remote")}</span>}
                    </div>

                    {job.other_listings && job.other_listings.length > 0 && (
                      <div className="text-xs text-t-phos-dim" data-testid="job-other-listings">
                        <p>{t("alsoListed")}</p>
                        <ul className="mt-1 space-y-1">
                          {job.other_listings.map((listing, i) => (
                            <li key={`${listing.source}-${i}`}>
                              {listing.place || t("placeNotSupplied")} ({listing.source})
                              {listing.apply_url && <>{" "}<a href={listing.apply_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-t-steel underline underline-offset-2 hover:opacity-80">{t("openListing")} &#8599;</a></>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

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

                    {!job.second_chance && job.marked_elsewhere && (
                      <div className="bg-t-panel-2 px-3 py-2 border border-t-amber">
                        <p className="text-xs font-medium text-t-amber-bright">{job.marked_elsewhere.reason}</p>
                      </div>
                    )}

                    {/* Requirements */}
                    {job.requirements.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-t-white mb-1.5 uppercase">
                          {t("lookingFor")}
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
                          {t("benefits")}
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
                          {t("saveJob")}
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
                            {t("markApplied")}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              unsaveJob(job.id);
                            }}
                            className="text-xs text-t-phos-dim hover:text-t-white"
                          >
                            {t("unsave")}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-t-amber-bright border border-t-amber px-3 py-1.5">
                          {t("applied")}
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
                        {t("tailorResume")}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissJob(job.id);
                        }}
                        className="text-xs text-t-phos-dim hover:text-t-white ml-auto"
                      >
                        {t("notForMe")}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setHideReason("");
                          setHideEmployerFor(hideEmployerFor === job.id ? null : job.id);
                        }}
                        className="text-xs text-t-phos-dim hover:text-t-red"
                        title={t("hideEmployerTitle")}
                      >
                        {t("hideEmployer")}
                      </button>
                    </div>

                    {/* N1: type-to-confirm + optional reason before hiding an employer. */}
                    {hideEmployerFor === job.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 border border-t-line bg-t-panel-2 p-3"
                      >
                        <p className="text-xs text-t-phos">
                          {t.rich("hideConfirm",{company:job.company,strong:(chunks) => <strong className="text-t-white">{chunks}</strong>})}
                        </p>
                        <textarea
                          value={hideReason}
                          onChange={(e) => setHideReason(e.target.value)}
                          placeholder={t("hideReasonPlaceholder")}
                          rows={2}
                          className="mt-2 w-full px-3 py-2 text-xs bg-t-panel border border-t-line text-t-white focus:border-t-amber focus:outline-none resize-y"
                        />
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => hideEmployer(job.company)}
                            className="t-focus px-3 py-1.5 text-xs font-bold bg-t-red text-white hover:opacity-90"
                          >
                            {t("hideCompany",{company:job.company})}
                          </button>
                          <button
                            onClick={() => { setHideEmployerFor(null); setHideReason(""); }}
                            className="text-xs text-t-phos-dim hover:text-t-white"
                          >
                            {tc("cancel")}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* External apply -- the LAST step, after saving and tailoring here */}
                    {(job.apply_url || job.employer_website) && (
                      <div className="bg-t-panel-2 px-3 py-2 border border-t-line">
                        <p className="text-xs text-t-phos mb-1">
                          <strong className="text-t-white">{t("lastStep")}</strong>{" "}
                          {t("lastStepBody")}
                        </p>
                        {job.apply_url ? (
                          <a
                            href={job.apply_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-medium text-t-steel underline underline-offset-2 hover:opacity-80 break-all"
                          >
                            {t("openApplicationPage")} &#8599;
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
            });
            if (groupIndex === 0) return <div key="main" className="space-y-3">{cards}</div>;
            if (!group.length) return null;
            return (
              <details key="also" className="border border-t-line p-3" data-testid="jobs-also-found">
                <summary className="t-focus min-h-touch cursor-pointer text-sm text-t-white">{t("alsoFound",{count:group.length})}</summary>
                <p className="mt-2 text-xs text-t-phos-dim">{t("alsoFoundNote")}</p>
                <div className="mt-3 space-y-3">{cards}</div>
              </details>
            );
          })}

          <p className="text-xs text-t-phos-dim text-center py-4">
            {t("sourcedNote")}
          </p>
        </div>
      )}

      {/* How it works — always visible at bottom */}
      <div className="mt-8 pt-6 border-t border-t-line">
        <h2 className="text-sm font-semibold text-t-white mb-3">
          {t("howTitle")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">{t("howRealTitle")}</span>
            <span className="text-xs text-t-phos-dim">
              {t("howRealBody")}
            </span>
          </div>
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">{t("howCheckedTitle")}</span>
            <span className="text-xs text-t-phos-dim">
              {t("howCheckedBody")}
            </span>
          </div>
          <div className="p-3 bg-t-panel border border-t-line">
            <span className="text-sm font-medium text-t-white block">{t("howSaveTitle")}</span>
            <span className="text-xs text-t-phos-dim">
              {t("howSaveBody")}
            </span>
          </div>
        </div>
      </div>

      {(picked.length > 0 || pickNotice) && (
        <div role="region" aria-label={t("pickBarAria")} data-testid="pick-bar" className="sticky bottom-0 z-20 mt-6 border border-t-amber bg-t-panel-2 p-3 shadow-[0_-3px_8px_rgba(22,26,21,0.25)]">
          {pickNotice && <p role="status" className="mb-2 text-sm text-t-amber-bright">{pickNotice}</p>}
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-t-white" aria-live="polite">
                <strong>{t("selected",{count:picked.length})}</strong>
                <span className="text-t-phos-dim"> · {t("pickCost",{count:picked.length})}</span>
              </p>
              <button type="button" onClick={tailorPicked} data-testid="pick-bar-tailor" className="t-focus min-h-touch bg-t-amber px-4 font-bold text-white hover:bg-t-amber-bright">
                {picked.length === 1 ? t("tailorForThis") : t("tailorForThese")}
              </button>
              <button type="button" onClick={() => { setPicked([]); setPickNotice(""); }} className="t-focus min-h-touch text-sm text-t-phos-dim underline">{t("clear")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
