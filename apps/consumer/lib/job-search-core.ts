/**
 * Job search core — real listings via JSearch + AI enrichment, callable
 * in-process (used by the /api/job-search route and by t.ROY's search_jobs
 * tool). Extracted from the route so the assistant can search without an
 * HTTP round-trip; behavior is identical to the pre-extraction route.
 *
 * Flow:
 *   1. Check cache (query_hash match within 6 hours)
 *   2. If miss: call JSearch API for real listings
 *   3. AI enrichment: fair-chance flags + 6th-grade descriptions
 *   4. Cache results for next query
 *   5. Return native job cards (no outbound URLs)
 *
 * Geo-bounded to tenant config (default: Milwaukee + Waukesha, 25mi radius).
 */

import { sanitizeForPrompt } from "@/lib/sanitize";
import { getTenantConfig } from "@/lib/tenant-config";
import { isMockEnabled, MOCK_JOB_RESULTS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import { getVerifiedEmployerNameSet, isVerifiedFairChance } from "@crucible/core";
import crypto from "crypto";

// Per-provider timeouts. The route caps at maxDuration=30s; without these a hung
// upstream (JSearch/CareerOneStop/AI) blocks the whole request and 504s (the QA
// failure). Each provider now fails fast to the next fallback, and if all fail
// the route returns an honest empty 200 -- never a gateway timeout.
//
// Values are evidence-based (measured 2026-08-06 against Troy's live key):
// JSearch num_pages=1 healthy responses ran ~6.4s (Grand Rapids); num_pages=2 ran
// 11.5-14.2s -- which, plus enrichment, is what blew the 30s cap in QA. We fetch
// one page now (see fetchJSearchJobs) and cap at 12s: covers a 2x slowdown with
// wide headroom, well under the route budget.
const JSEARCH_TIMEOUT_MS = 12000;
const CAREERONESTOP_TIMEOUT_MS = 7000;
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

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  employer_logo: string | null;
  job_city: string;
  job_state: string;
  job_country: string;
  job_description: string;
  job_min_salary: number | null;
  job_max_salary: number | null;
  job_salary_currency: string | null;
  job_salary_period: string | null;
  job_employment_type: string;
  job_posted_at_datetime_utc: string;
  job_is_remote: boolean;
  employer_website: string | null;
  job_apply_link?: string | null;
  job_google_link?: string | null;
  job_highlights?: {
    Qualifications?: string[];
    Responsibilities?: string[];
    Benefits?: string[];
  };
}

export interface EnrichedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  description: string;
  full_description: string;
  requirements: string[];
  benefits: string[];
  employment_type: string;
  posted: string;
  second_chance: boolean;
  fair_chance_reason: string | null;
  remote: boolean;
  apply_url: string | null;
  employer_website: string | null;
}

export interface JobSearchParams {
  role: string;
  location?: string;
  skills?: string[];
  hasRecord?: boolean;
  recordType?: string;
}

export interface JobSearchOutcome {
  jobs: EnrichedJob[];
  fair_chance_info: string;
  source: string;
  error?: string;
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

function hashQuery(params: Record<string, unknown>): string {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
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

// ─── JSearch API ────────────────────────────────────────────────────────────

// Distinguishes "provider failed" (quota, outage, missing key) from a genuine
// zero-result search, so failures can be surfaced to the user instead of
// silently rendering as "no jobs found".
async function fetchJSearchJobs(
  role: string,
  location: string,
  radiusMiles: number
): Promise<{ jobs: JSearchJob[]; failed: boolean; status?: number }> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    console.error("JSEARCH_API_KEY not set");
    return { jobs: [], failed: true };
  }

  const query = `${role} in ${location}`;
  // JSearch retired /search (404 as of 2026-08); /search-v2 returns the same
  // job objects wrapped in { data: { jobs, cursor } }.
  // num_pages=1 (10 listings, ~6s) instead of 2 (20 listings, ~12-14s): the
  // enrichment/board only ever surfaces 15, so the second page mostly added
  // latency that pushed the request past the route cap. One page keeps the board
  // fast and reliable; fair-chance-first sorting still applies.
  const url = new URL("https://jsearch.p.rapidapi.com/search-v2");
  url.searchParams.set("query", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("num_pages", "1");
  url.searchParams.set("date_posted", "month");
  url.searchParams.set("radius", String(radiusMiles));

  try {
    const res = await fetchJsonWithTimeout(
      url.toString(),
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        },
      },
      JSEARCH_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error(`JSearch API error: ${res.status} ${res.statusText}`);
      return { jobs: [], failed: true, status: res.status };
    }

    // v2 envelope is { data: { jobs, cursor } }; tolerate the old flat array
    // shape too in case the provider flips again.
    const payload = res.json?.data;
    const jobs = Array.isArray(payload) ? payload : (payload?.jobs ?? []);
    return { jobs, failed: false };
  } catch (err) {
    console.error("JSearch fetch failed:", err);
    return { jobs: [], failed: true };
  }
}

// ─── AI Enrichment ──────────────────────────────────────────────────────────
//
// Fair-chance flags come from ONE source of truth: exact-name matches against the
// verified `employer` table (core `isVerifiedFairChance`). Codex 12 killed the old
// hardcoded substring list (which flagged "Targeted Staffing" because it contains
// "target") and the AI's ability to guess the flag. The AI now only simplifies
// copy; it never stamps an employer fair-chance. Unknown is not a "no" -- it just
// means the platform hasn't verified this employer, so no badge is shown.

// ─── CareerOneStop (DOL) Fallback ───────────────────────────────────────────
// Free, official job source used when JSearch returns zero. Env-gated and
// fail-safe (returns [] on any error, so the board degrades to "no results").
// Mapping follows the documented COS jobsearch response shape (Jobs[]). NOTE:
// live creds returned 401 at build time (2026-06-07) -- verify the field mapping
// with a real successful call once the User ID/token are active.

interface CareerOneStopJob {
  JvId?: string;
  JobTitle?: string;
  Company?: string;
  Location?: string;
  AccquisitionDate?: string;
  URL?: string | null;
}

async function fetchCareerOneStopJobs(
  keyword: string,
  location: string,
  verified: Set<string>
): Promise<EnrichedJob[]> {
  const uid = process.env.CAREERONESTOP_USER_ID;
  const tok = process.env.CAREERONESTOP_TOKEN;
  if (!uid || !tok) return [];

  const kw = encodeURIComponent(keyword || "jobs");
  const loc = encodeURIComponent(location || "United States");
  // v1/jobsearch/{userId}/{keyword}/{location}/{radius}/{sort}/{order}/{start}/{pageSize}/{days}
  const url = `https://api.careeronestop.org/v1/jobsearch/${uid}/${kw}/${loc}/25/0/0/0/15/30`;

  try {
    const res = await fetchJsonWithTimeout(
      url,
      { headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } },
      CAREERONESTOP_TIMEOUT_MS
    );
    if (!res.ok) {
      console.error(`CareerOneStop API error: ${res.status}`);
      return [];
    }
    const jobs: CareerOneStopJob[] = res.json?.Jobs ?? [];
    return jobs.slice(0, 15).map((j, i) => {
      const company = j.Company || "Employer";
      const fair = isVerifiedFairChance(company, verified);
      return {
        id: j.JvId || `cos-${i}`,
        title: j.JobTitle || "Job",
        company,
        location: j.Location || location,
        salary: null,
        description: "",
        full_description: "",
        requirements: [],
        benefits: [],
        employment_type: "",
        posted: j.AccquisitionDate || "",
        second_chance: fair,
        fair_chance_reason: fair ? "Verified fair-chance employer" : null,
        remote: false,
        apply_url: j.URL || null,
        employer_website: null,
      };
    });
  } catch (err) {
    console.error("CareerOneStop fetch failed:", err);
    return [];
  }
}

async function enrichJobsWithAI(
  jobs: JSearchJob[],
  context: { hasRecord: boolean; recordType?: string; location: string },
  verified: Set<string>
): Promise<{ enrichedJobs: EnrichedJob[]; fairChanceInfo: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Pre-process: build basic enriched jobs without AI
  const basicJobs: EnrichedJob[] = jobs.slice(0, 15).map((j) => {
    const salary = formatSalary(j);
    const posted = formatPosted(j.job_posted_at_datetime_utc);
    const title = unwrapMaybeJsonArray(j.job_title);
    const company = unwrapMaybeJsonArray(j.employer_name);
    const fair = isVerifiedFairChance(company, verified);

    return {
      id: j.job_id,
      title,
      company,
      location: [j.job_city, j.job_state].filter(Boolean).join(", "),
      salary,
      description: truncateDescription(j.job_description, 200),
      full_description: truncateDescription(j.job_description, 2000),
      requirements: j.job_highlights?.Qualifications?.slice(0, 3) ?? [],
      benefits: j.job_highlights?.Benefits?.slice(0, 3) ?? [],
      employment_type: j.job_employment_type || "Full-time",
      posted,
      second_chance: fair,
      fair_chance_reason: fair ? "Verified fair-chance employer" : null,
      remote: j.job_is_remote,
      apply_url: j.job_apply_link || j.job_google_link || null,
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
    const jobSummaries = basicJobs.map((j, i) => ({
      index: i,
      title: j.title,
      company: j.company,
      description: j.description,
    }));

    const prompt = `You are a reentry employment specialist. Simplify these job listings for someone with a criminal record looking for work in ${sanitizeForPrompt(context.location)}.

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
  "fair_chance_info": "1-2 sentences about fair-chance hiring laws in ${sanitizeForPrompt(context.location)}. Mention Wisconsin's ban-the-box law if applicable."
}

RULES:
- Only rewrite the description into plain language. Do NOT judge which employers are fair-chance -- that is decided elsewhere.
- Keep descriptions simple and actionable
- 6th grade reading level
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
        { endpoint: "job-search" },
        enrichController.signal
      );
    } catch {
      return { enrichedJobs: basicJobs, fairChanceInfo: "" };
    } finally {
      clearTimeout(enrichTimer);
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const enrichment = JSON.parse(jsonMatch[0]);

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

function formatSalary(job: JSearchJob): string | null {
  if (!job.job_min_salary && !job.job_max_salary) return null;
  const period = job.job_salary_period?.toLowerCase() ?? "year";
  const isHourly = period === "hour";
  const min = job.job_min_salary;
  const max = job.job_max_salary;

  if (min && max) {
    if (isHourly) return `$${min}-${max}/hr`;
    return `$${Math.round(min / 1000)}k-${Math.round(max / 1000)}k/yr`;
  }
  if (min) {
    if (isHourly) return `$${min}/hr+`;
    return `$${Math.round(min / 1000)}k+/yr`;
  }
  if (max) {
    if (isHourly) return `Up to $${max}/hr`;
    return `Up to $${Math.round(max / 1000)}k/yr`;
  }
  return null;
}

function formatPosted(datetime: string): string {
  if (!datetime) return "Recently";
  const diff = Date.now() - new Date(datetime).getTime();
  const days = Math.floor(diff / 86400000);
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

export async function runJobSearch(params: JobSearchParams): Promise<JobSearchOutcome> {
  if (isMockEnabled()) {
    return MOCK_JOB_RESULTS as JobSearchOutcome;
  }

  const { role, location, skills, hasRecord, recordType } = params;

  const tenantGeo = getTenantConfig().geo;
  const searchLocation = sanitizeForPrompt(location ?? "") || tenantGeo.primaryLocations[0];

  // Build cache key from search params
  const cacheParams = {
    role: sanitizeForPrompt(role),
    location: searchLocation,
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
  const verified = await withDeadline(
    getVerifiedEmployerNameSet(),
    DB_DEADLINE_MS,
    new Set<string>(),
    "verified employers"
  );

  // 2. Fetch from JSearch
  const jsearch = await fetchJSearchJobs(
    sanitizeForPrompt(role) || "jobs",
    searchLocation,
    tenantGeo.searchRadiusMiles
  );
  const rawJobs = jsearch.jobs;

  if (rawJobs.length === 0) {
    // Fallback to CareerOneStop (DOL) -- free + official. Env-gated, fail-safe.
    const cosJobs = await fetchCareerOneStopJobs(
      sanitizeForPrompt(role) || "jobs",
      searchLocation,
      verified
    );
    if (cosJobs.length > 0) {
      cosJobs.sort((a, b) =>
        a.second_chance === b.second_chance ? 0 : a.second_chance ? -1 : 1
      );
      await withDeadline(cacheResults(queryHash, cacheParams, cosJobs, ""), DB_DEADLINE_MS, undefined, "cache write (cos)");
      return {
        jobs: cosJobs,
        fair_chance_info: "",
        source: "careeronestop",
      };
    }
    // Provider failed (quota/outage/key) vs. genuinely zero matches --
    // never let a failure render as "no jobs found".
    if (jsearch.failed) {
      return {
        jobs: [],
        fair_chance_info: "",
        source: "jsearch",
        error:
          jsearch.status === 429 ? "provider_rate_limited" : "provider_unavailable",
      };
    }
    return {
      jobs: [],
      fair_chance_info: "",
      source: "jsearch",
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
    },
    verified
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
        contextPage: "job-search",
        modelProvider: `jsearch+${AI_PROVIDER}`,
        modelId: `jsearch-v1+${AI_MODEL}`,
        input: JSON.stringify({ targetRole: role, location, skills, hasRecord }).slice(0, 500),
        explanation: `JSearch API: ${rawJobs.length} raw results for "${role || "general"}" in ${searchLocation}. ${AI_PROVIDER} enriched ${enrichedJobs.length} listings. Fair-chance: ${enrichedJobs.filter((j) => j.second_chance).length}.`,
        outputSummary: {
          type: "job_search",
          source: "jsearch",
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
    source: "jsearch",
  };
}
