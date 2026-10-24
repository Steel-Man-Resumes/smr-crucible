import { searchRoles, jobRelevance, relatedTerms } from './job-search-relevance';
import { normalizeLocation } from './job-location';
/**
 * One bounded provider search and deterministic filter path for Job Board and coach.
 * Cache public source listings; apply current lane choices after cache reads.
 * Source fields remain separate from plain-language AI descriptions. Missing
 * evidence stays unknown, and no retry widens the person's chosen constraints.
 * Verified employer marks remain the only source of second-chance badges.
 */

import { sanitizeOrEmpty } from "@/lib/sanitize";
import { getTenantConfig } from "@/lib/tenant-config";
import { isMockEnabled, MOCK_JOB_RESULTS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import { plainPunctuation, logDashSwaps } from "@/lib/legal-sanitize";
import { getEmployerMarks, isMarked, getOneAsUser, type EmployerMarks } from "@crucible/core";
import { fetchJSearchJobs, fetchAdzunaJobs, fetchUsaJobs, mergeJobs } from "./job-providers";
import { assessJobSearch, canonicalSearchFilters, defaultJobSearchFilters, readJobSearchFilters, type JobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import { evidenceForJob, formatSourceSalary } from "./job-search-evidence";
import { loadJobSearchPreferences } from "./job-search-preferences";
import type { JSearchJob, EnrichedJob, JobSearchOutcome, JobSearchSummary } from "./job-search-types";
export type { JSearchJob, EnrichedJob, JobSearchOutcome } from "./job-search-types";
import crypto from "crypto";
import { readJobFit, jobFitExclusion } from "./job-fit";

const PARALLEL_PROVIDER_TIMEOUT_MS = 8000;
const AI_ENRICH_TIMEOUT_MS = 10000;

// Full-lifecycle deadline (Codex 10): fetch() resolves at HEADERS, so a slow/stalled
// response BODY still hangs res.json() past the route cap and 504s. Keeping the timer
// armed through res.json() puts the body read under the same abort signal, so a body
// stall aborts instead of hanging. Only the success path reads the body.
async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; statusText: string; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, statusText: res.statusText, json: null };
    }
    const json = await res.json();
    return { ok: true, status: res.status, statusText: res.statusText, json };
  } finally {
    clearTimeout(timer);
  }
}

// Bound a DB / side-channel promise so a stalled dependency can't blow the route
// budget (Codex 10). On timeout OR error we resolve to `fallback` and let the request
// proceed; the detached promise's late settle is swallowed, never unhandled.
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[job-search] ${label} exceeded ${ms}ms -- proceeding without it`);
      resolve(fallback);
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); console.error(`[job-search] ${label} failed:`, err); resolve(fallback); }
    );
  });
}

// Bound for cache reads/writes and the decision-log write (all Neon).
const DB_DEADLINE_MS = 3000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JobSearchParams {
  role?: string;
  searchRoles?: string[];
  location?: string;
  filters?: unknown;
  laneId?: string | null;
  resolvedFilters?: JobSearchFilters;
  skills?: string[];
  hasRecord?: boolean;
  recordType?: string;
  /** The signed-in user, when known. Threaded to the enrichment AI call so its
   *  cost attributes to the right person instead of landing user_id NULL and
   *  becoming invisible in the per-user and own-usage rollups. Null on a shared
   *  cache-warm or an anonymous call. */
  userId?: string | null;
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

export function hashQuery(params: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a],[b]) => a.localeCompare(b))))).digest("hex").slice(0, 24);
}

interface CachedSearchResult {
  results: EnrichedJob[];
  fair_chance_info: string;
}

async function getCachedResults(queryHash: string): Promise<CachedSearchResult | null> {
  try {
    const { getOne } = await import("@crucible/core");
    const row = await getOne<{ results: EnrichedJob[]; fair_chance_info: string }>(
      `SELECT results, fair_chance_info FROM job_search_cache WHERE query_hash = $1 AND expires_at > NOW()`,
      [queryHash]
    );
    if (!row) return null;
    return { results: row.results, fair_chance_info: row.fair_chance_info || "" };
  } catch {
    return null;
  }
}

async function cacheResults(
  queryHash: string,
  queryParams: Record<string, unknown>,
  results: EnrichedJob[],
  fairChanceInfo: string
): Promise<void> {
  try {
    const { query } = await import("@crucible/core");
    await query(
      `INSERT INTO job_search_cache (query_hash, query_params, results, result_count, fair_chance_info, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '6 hours')
       ON CONFLICT (query_hash)
       DO UPDATE SET results = $3, result_count = $4, fair_chance_info = $5, fetched_at = NOW(), expires_at = NOW() + INTERVAL '6 hours'`,
      [queryHash, JSON.stringify(queryParams), JSON.stringify(results), results.length, fairChanceInfo]
    );
  } catch (err) {
    console.error("Cache write failed:", err);
  }
}

/**
 * Find a job by id inside any unexpired cached search result. Used by the
 * assistant's save_job tool so a job discussed in chat can be saved without
 * the model echoing the full job object through tool arguments.
 */
export async function findCachedJob(jobId: string): Promise<EnrichedJob | null> {
  try {
    const { getOne } = await import("@crucible/core");
    const row = await getOne<{ job: EnrichedJob }>(
      `SELECT j.value AS job
         FROM job_search_cache c,
              LATERAL jsonb_array_elements(c.results) j
        WHERE c.expires_at > NOW()
          AND j.value->>'id' = $1
        ORDER BY c.fetched_at DESC
        LIMIT 1`,
      [jobId]
    );
    return row?.job ?? null;
  } catch {
    return null;
  }
}

async function enrichJobsWithAI(
  jobs: JSearchJob[],
  context: { hasRecord: boolean; recordType?: string; location: string; userId?: string | null },
  marks: EmployerMarks
): Promise<{ enrichedJobs: EnrichedJob[]; fairChanceInfo: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Pre-process: build basic enriched jobs without AI
  const basicJobs: EnrichedJob[] = jobs.map((j) => {
    const evidence = evidenceForJob(j);
    const salary = formatSourceSalary(evidence.salary);
    const posted = formatPosted(j.job_posted_at_datetime_utc);
    const title = unwrapMaybeJsonArray(j.job_title);
    const company = unwrapMaybeJsonArray(j.employer_name);
    // The mark needs the listing's own place and title: a directory mark is
    // earned at a place, sometimes for one role (DIRECTORY_MARK_ENABLED).
    const fair = isMarked(company, { city: j.job_city ?? null, state: j.job_state ?? null, title }, marks);

    return {
      id: j.job_id,
      title,
      company,
      // JSearch returns null city AND state on some listings (verified
      // 2026-09-19: a real USPS opening in Libby, MT came back [null, null]),
      // which joined to an empty string and rendered a job card with no
      // location at all. Fall back to what the person actually searched --
      // the listing did match that search -- rather than showing a blank.
      // normalizeLocation drops a state or country the provider repeated inside
      // the city field ("Milwaukee, Wisconsin, Wisconsin").
      location: normalizeLocation(j.job_city, j.job_state) || "Location not supplied",
      ...(j.job_locations?.length ? { other_locations: j.job_locations } : {}),
      salary,
      description: truncateDescription(j.job_description, 200),
      full_description: truncateDescription(j.job_description, 20000),
      requirements: j.job_highlights?.Qualifications?.slice(0, 3) ?? [],
      benefits: j.job_highlights?.Benefits?.slice(0, 3) ?? [],
      employment_type: j.job_employment_type || "Type not supplied",
      posted,
      second_chance: fair,
      fair_chance_reason: fair ? "We checked: this employer hires people with records here." : null,
      remote: j.job_is_remote === true,
      evidence, source_fields: j.source_fields, source_variants: j.source_variants,
      apply_url: j.apply_options?.find((option) => option.is_direct === true && option.apply_link)?.apply_link || j.job_apply_link || j.job_google_link || null,
      employer_website: j.employer_website || null,
    };
  });

  // If no API key, return basic enrichment
  if (!apiKey) {
    return { enrichedJobs: basicJobs, fairChanceInfo: "" };
  }

  // AI enrichment: simplify descriptions only. Fair-chance flags are NOT the AI's
  // to decide (Codex 12) -- they are set deterministically from the verified
  // employer table above and passed through untouched.
  try {
    const jobSummaries = basicJobs.slice(0, 15).map((j, i) => ({
      index: i,
      title: j.title,
      company: j.company,
      description: j.description,
    }));

    const prompt = `You are a reentry employment specialist. Simplify these job listings for someone with a criminal record looking for work in ${sanitizeOrEmpty(context.location) || "their area"}.

JOBS:
${JSON.stringify(jobSummaries)}

Return JSON:
{
  "jobs": [
    {
      "index": 0,
      "simple_description": "What this job involves in plain language. 1-2 sentences. 6th grade reading level."
    }
  ],
  "fair_chance_info": "1-2 sentences of practical encouragement for applying with a record in ${sanitizeOrEmpty(context.location) || "their area"}."
}

RULES:
- Only rewrite the description into plain language. Do NOT judge which employers hire people with records. That is decided elsewhere.
- Keep descriptions simple and actionable
- 6th grade reading level
- Use plain words. In fair_chance_info, say "employers that hire people with records". Never write "fair-chance" or "justice-impacted" anywhere. Never say in a description whether that employer hires people with records.
- Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence.
- fair_chance_info is PRACTICAL guidance only. Do NOT name, cite, paraphrase, or
  characterize any statute, ordinance, ban-the-box law, or legal protection, and
  do NOT state what any jurisdiction requires of employers. The platform does not
  give legal advice, and a wrong or out-of-jurisdiction legal claim is worse than
  no claim. (This previously hardcoded a prompt to mention Wisconsin's law, which
  followed the search into every other state.)
- JSON only, no markdown`;

    let text: string;
    // Bound enrichment so a slow model never blows the route budget, and ACTUALLY
    // ABORT the request on timeout rather than just racing it (Codex 10) -- a raced-
    // but-not-aborted call leaves the socket open and keeps billing tokens. On timeout
    // we return the real listings with basic (un-simplified) copy: degraded, never a
    // 504, never fabricated.
    const enrichController = new AbortController();
    const enrichTimer = setTimeout(() => enrichController.abort(), AI_ENRICH_TIMEOUT_MS);
    try {
      text = await callAI(
        "",
        [{ role: "user", content: prompt }],
        2000,
        undefined,
        { endpoint: "job-search", userId: context.userId ?? null },
        enrichController.signal
      );
    } catch {
      return { enrichedJobs: basicJobs, fairChanceInfo: "" };
    } finally {
      clearTimeout(enrichTimer);
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      // Every field in this JSON is model-written (simplified copy + guidance),
      // so the whole object goes through the dash sweep.
      const enrichment = plainPunctuation(JSON.parse(jsonMatch[0]), logDashSwaps("job-search"));

      // Merge enrichment back into basic jobs -- description copy ONLY. The
      // fair-chance flag stays exactly as the verified-table match set it (Codex 12).
      for (const ej of enrichment.jobs ?? []) {
        const job = basicJobs[ej.index];
        if (job && ej.simple_description) {
          job.description = ej.simple_description;
        }
      }

      return {
        enrichedJobs: basicJobs,
        fairChanceInfo: enrichment.fair_chance_info || "",
      };
    }
  } catch (err) {
    console.error("AI enrichment failed:", err);
  }

  return { enrichedJobs: basicJobs, fairChanceInfo: "" };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPosted(datetime: string): string {
  if (!datetime || !Number.isFinite(Date.parse(datetime))) return "Posting date not supplied";
  const diff = Date.now() - new Date(datetime).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 0) return "Check source posting date";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return "Over a month ago";
}

// JSearch /search-v2 sometimes returns a field (notably job_title) as a
// JSON-array-encoded STRING when it aggregates duplicate postings, e.g.
// '["Warehouse Associate","Warehouse Associate"]'. Rendered as-is that shows raw
// brackets/quotes on the board. Unwrap to the first entry; pass plain values
// through untouched.
function unwrapMaybeJsonArray(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  if (typeof value !== "string") return value == null ? "" : String(value);
  const s = value.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length) return String(arr[0] ?? "");
    } catch {
      /* not JSON -- fall through and return the original string */
    }
  }
  return value;
}

function truncateDescription(desc: string, maxLen: number): string {
  if (!desc) return "";
  // Strip HTML tags
  const clean = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s\S*$/, "") + "...";
}

// ─── Search ─────────────────────────────────────────────────────────────────

/** Page and coach resolve the same saved lane/default choices before provider and cache work. */
export async function runJobSearch(params: JobSearchParams): Promise<JobSearchOutcome> {
  const saved = params.userId ? await loadJobSearchPreferences(params.userId, params.laneId) : null;
  const filters = readJobSearchFilters(params.filters, saved?.saved.filters || defaultJobSearchFilters());
  const profile = params.userId ? await (await import("@crucible/core")).getUserProfile(params.userId) : null;
  const skills = profile?.topSkills || params.skills || [];
  const requestedRole = params.role === undefined ? saved?.saved.role || "" : params.role;
  const roles = searchRoles(requestedRole, saved?.target || (!saved?.laneId ? profile?.topCareerPaths[0] || "" : ""), skills);
  const related = roles.length ? relatedTerms(roles[0]) : [];
  const relatedUsed = roles.slice(1).filter(r => related.some(t => t.toLowerCase() === r.toLowerCase()));
  const result = await searchListings({ ...params, role: roles[0] || requestedRole, searchRoles: roles, location: params.location === undefined ? saved?.saved.location || "" : params.location, resolvedFilters: filters });
  let hidden = new Set<string>();
  let personal = readJobFit(null);
  if (params.userId) {
    const { getHiddenEmployerSet } = await import("@crucible/core");
    const [row, employers] = await Promise.all([getOneAsUser<{ job_fit: unknown }>(params.userId, "SELECT preferences->'jobFit' AS job_fit FROM consumer_profile WHERE user_id=$1", [params.userId]), getHiddenEmployerSet(params.userId)]);
    personal = readJobFit(row?.job_fit); hidden = employers;
  }
  const { isHiddenEmployer } = await import("@crucible/core");
  const excludedBy: Record<string, number> = {}, unknownBy: Record<string, number> = {};
  const loaded = result.jobs.length;
  const jobs = result.jobs.flatMap((job) => {
    const assessment = assessJobSearch(job, filters);
    const personalReason = jobFitExclusion(job, personal);
    if (personalReason || isHiddenEmployer(job.company, hidden)) { excludedBy.personal = (excludedBy.personal || 0) + 1; return []; }
    assessment.unmet.forEach(key => { excludedBy[key] = (excludedBy[key] || 0) + 1; });
    if (!filters.includeUnknown) assessment.requiredUnknown.forEach(key => { excludedBy[`unknown_${key}`] = (excludedBy[`unknown_${key}`] || 0) + 1; });
    if (!assessment.included) return [];
    assessment.unknown.forEach(key => { unknownBy[key] = (unknownBy[key] || 0) + 1; });
    const relevance = jobRelevance(job, roles, skills, related);
    // Off-topic listings (none of the search words in title or description)
    // are dropped and counted, never silently: the summary says how many.
    if (relevance.tier === "none") { excludedBy.off_topic = (excludedBy.off_topic || 0) + 1; return []; }
    return [{ ...job, relevance, filterAssessment: assessment }];
  });
  jobs.sort((a,b) => b.relevance.score - a.relevance.score || a.filterAssessment.preferred.length - b.filterAssessment.preferred.length);
  const offTopic = excludedBy.off_topic || 0, alsoFound = jobs.filter(j => j.relevance.tier === "description").length;
  const summary: JobSearchSummary = { loaded, matched: jobs.length, excluded: loaded - jobs.length, unknownIncluded: jobs.filter(j => j.filterAssessment.unknown.length > 0).length, excludedBy, unknownBy, providerRequests: result.metadata?.providerRequests || 0, partial: true, fetchedAt: result.jobs[0]?.evidence?.fetchedAt || new Date().toISOString(), filters, laneId: saved?.laneId || null,
    offTopic, alsoFound, ...(relatedUsed.length ? { relatedTerms: relatedUsed } : {}),
    notices: [...(roles.length ? [`Search directions: ${roles.join("; ")}. Ordered by title match first, then description and saved skill overlap, not confirmed eligibility.`] : ["Add a role or save a career direction for more focused results."]),
      ...(relatedUsed.length ? [`We also searched ${relatedUsed.map(r => `"${r}"`).join(" and ")}, a related term for "${roles[0]}". Cards say when only the related term matched.`] : []),
      ...(offTopic ? [`${offTopic} loaded listing${offTopic === 1 ? "" : "s"} left out because none of your search words appear in the title or description.`] : []),
      ...(alsoFound ? [`${alsoFound} listing${alsoFound === 1 ? "" : "s"} only mention your search words in the description. They are under "Also found" below the main list.`] : []), "Counts cover the listings loaded for this search, not every opening.", ...(!filters.origin && filters.radiusMiles.value !== null ? ["Distance is unverified without an exact search center. Provider radius is approximate."] : []), ...(result.metadata?.notices || [])] };
  const { metadata: _metadata, ...publicResult } = result;
  return { ...publicResult, jobs, summary };
}

async function searchListings(params: JobSearchParams): Promise<JobSearchOutcome> {
  if (isMockEnabled()) {
    return MOCK_JOB_RESULTS as JobSearchOutcome;
  }

  const { role, location, skills, hasRecord, recordType, userId } = params;
  const filters = params.resolvedFilters || defaultJobSearchFilters();

  const tenantGeo = getTenantConfig().geo;
  const searchLocation = sanitizeOrEmpty(location) || (filters.radiusMiles.value === null && filters.arrangements.value.length === 1 && filters.arrangements.value[0] === "remote" ? "United States" : "");
  if (!searchLocation) return { jobs: [], source: "none", fair_chance_info: "", error: "location_required" };

  // Build cache key from search params
  const cacheParams = {
    role: sanitizeOrEmpty(role),
    location: searchLocation,
    version: 4,
    roles: params.searchRoles || [],
    filtersHash: hashQuery({ filters: canonicalSearchFilters(filters) }),
  };
  const queryHash = hashQuery(cacheParams);

  // 1. Check cache (bounded -- a stalled read falls through to a live search)
  const cached = await withDeadline(getCachedResults(queryHash), DB_DEADLINE_MS, null, "cache read");
  if (cached) {
    return {
      jobs: cached.results,
      fair_chance_info: cached.fair_chance_info,
      source: "cache",
    };
  }

  // Single source of truth for fair-chance flags: exact-name matches against the
  // verified employer table (Codex 12). Bounded so a stalled employer query never
  // blows the route budget; a failure yields an empty set -- no false badges.
  const marks = await withDeadline<EmployerMarks>(
    getEmployerMarks(),
    DB_DEADLINE_MS,
    { source: "legacy", names: new Set<string>() },
    "verified employers"
  );

  // 2. Fetch listings from every configured provider CONCURRENTLY.
  //
  // This used to be a chain: JSearch had to fully fail before anything else ran,
  // which spent the whole budget serially and meant one stalled provider could
  // end the search on its own. Running them together means a stall in one costs
  // nothing -- the others have already answered.
  //
  // Providers are independent by construction: each is separately configured,
  // separately bounded, and returns `failed` rather than throwing, so one being
  // unconfigured, rate-limited, or down never removes the others.
  // roleClean stays "" for a location-only search so USAJOBS can skip its
  // Keyword filter; the other providers get the "jobs" fallback.
  const roleClean = sanitizeOrEmpty(role);
  const searchRole = roleClean || "jobs";
  const providerNames: string[] = [];
  const roles = params.searchRoles?.length ? params.searchRoles : [searchRole];
  const multi = roles.length > 1;
  const settled = await Promise.all([
    ...roles.map(r => fetchJSearchJobs(r, searchLocation, filters.radiusMiles.value ?? tenantGeo.searchRadiusMiles, { filters, maxPages: multi ? 1 : 2 }).then(result => { if(result.jobs.length) providerNames.push("jsearch"); return result; })),
    ...roles.map(r => fetchAdzunaJobs(r, searchLocation, filters.radiusMiles.value ?? tenantGeo.searchRadiusMiles, PARALLEL_PROVIDER_TIMEOUT_MS, { filters, maxPages: multi ? 1 : 2 }).then(result => { if(result.jobs.length) providerNames.push("adzuna"); return result; })),
    fetchUsaJobs(roleClean, searchLocation, PARALLEL_PROVIDER_TIMEOUT_MS, { filters, maxPages: multi ? 1 : 2 }).then(result => { if(result.jobs.length) providerNames.push("usajobs"); return result; }),
  ]);
  const sources = [...roles.map(() => "JSearch"), ...roles.map(() => "Adzuna"), "USAJOBS"];
  const failedSources = [...new Set(settled.flatMap((r, i) => r.failed ? [sources[i]] : []))];
  const cutShort = settled.some(r => r.partial);
  const metadata = { providerRequests: settled.reduce((n,r) => n + (r.requests || 0), 0), notices: [
    ...(failedSources.length ? [`${failedSources.join(" and ")} did not answer this search, so ${failedSources.length === 1 ? "its" : "their"} listings are missing.`] : []),
    ...(cutShort ? ["Some providers reached the bounded page limit. More openings may exist."] : []),
  ] };
  const rawJobs = mergeJobs(settled.map(result => result.jobs), searchLocation);
  const allFailed = settled.every((r) => r.failed || r.jobs.length === 0);

  if (rawJobs.length === 0) {
    // Provider failed (quota/outage/key) vs. genuinely zero matches --
    // never let a failure render as "no jobs found". USAJOBS lists federal
    // openings only, so a clean empty answer from it alone says nothing about
    // trade or private-sector jobs: when every general board (JSearch, Adzuna)
    // failed, this is a source outage, not an empty market. (Before this, a
    // clean USAJOBS zero turned two failed boards into "0 kept from 0 loaded".)
    const generalBoards = settled.slice(0, roles.length * 2);
    const anyCleanEmpty = generalBoards.some((r) => !r.failed);
    if (!anyCleanEmpty && allFailed) {
      return {
        jobs: [],
        fair_chance_info: "",
        source: "none",
        metadata,
        error: settled.some((r) => r.status === 429)
          ? "provider_rate_limited"
          : "provider_unavailable",
      };
    }
    return {
      jobs: [],
      fair_chance_info: "",
      source: "none",
      metadata,
    };
  }

  // 3. Enrich with AI (simplified descriptions only; fair-chance flags already set
  // deterministically from the verified employer table)
  const { enrichedJobs, fairChanceInfo } = await enrichJobsWithAI(
    rawJobs,
    {
      hasRecord: Boolean(hasRecord),
      recordType,
      location: searchLocation,
      userId: userId ?? null,
    },
    marks
  );

  // 4. Sort: fair-chance first, then by recency
  enrichedJobs.sort((a, b) => {
    if (a.second_chance && !b.second_chance) return -1;
    if (!a.second_chance && b.second_chance) return 1;
    return 0;
  });

  // 5. Cache results (bounded -- including fair_chance_info so cache hits return complete data)
  await withDeadline(
    cacheResults(queryHash, cacheParams, enrichedJobs, fairChanceInfo),
    DB_DEADLINE_MS,
    undefined,
    "cache write"
  );

  // 6. Log decision for JBS compliance (bounded -- a stalled DB write must never hang
  // the response past the route budget; Codex 10).
  await withDeadline(
    (async () => {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId: params.userId ?? null,
        contextPage: "job-search",
        modelProvider: `${providerNames.join("+") || "none"}+${AI_PROVIDER}`,
        modelId: `job-search-v1+${AI_MODEL}`,
        input: JSON.stringify({ targetRole: role, location, skills, hasRecord }).slice(0, 500),
        explanation: `Job providers (${providerNames.join(", ") || "none"}): ${rawJobs.length} raw results. ${AI_PROVIDER} enriched ${enrichedJobs.length} listings. Fair-chance: ${enrichedJobs.filter((j) => j.second_chance).length}.`,
        outputSummary: {
          type: "job_search",
          source: providerNames.join("+") || "none",
          raw_count: rawJobs.length,
          enriched_count: enrichedJobs.length,
          second_chance_count: enrichedJobs.filter((j) => j.second_chance).length,
        },
      });
    })(),
    DB_DEADLINE_MS,
    undefined,
    "decision log"
  );

  return {
    jobs: enrichedJobs,
    fair_chance_info: fairChanceInfo,
    // Which providers actually contributed, so a degraded search is visible
    // rather than silently looking like a healthy one.
    source: providerNames.length ? providerNames.join("+") : "none",
    metadata,
  };
}
