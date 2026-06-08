/**
 * Job Search API — Real listings via JSearch + AI enrichment
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

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { getTenantConfig } from "@/lib/tenant-config";
import { isMockEnabled, MOCK_JOB_RESULTS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import crypto from "crypto";

export const maxDuration = 30;

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

interface EnrichedJob {
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

// ─── JSearch API ────────────────────────────────────────────────────────────

async function fetchJSearchJobs(
  role: string,
  location: string,
  radiusMiles: number
): Promise<JSearchJob[]> {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    console.error("JSEARCH_API_KEY not set");
    return [];
  }

  const query = `${role} in ${location}`;
  const url = new URL("https://jsearch.p.rapidapi.com/search");
  url.searchParams.set("query", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("num_pages", "2");
  url.searchParams.set("date_posted", "month");
  url.searchParams.set("radius", String(radiusMiles));

  const res = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    },
  });

  if (!res.ok) {
    console.error(`JSearch API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json();
  return data.data ?? [];
}

// ─── AI Enrichment ──────────────────────────────────────────────────────────

const KNOWN_FAIR_CHANCE_EMPLOYERS = [
  "walmart", "target", "amazon", "fedex", "ups", "goodwill", "salvation army",
  "dave's hot chicken", "home depot", "lowe's", "tyson foods", "koch industries",
  "jp morgan", "jpmorgan", "chase", "bank of america", "starbucks",
  "greyston bakery", "nehemiah manufacturing", "mcdonald's", "wendy's",
  "burger king", "taco bell", "chipotle", "kroger", "aldi", "costco",
  "marshalls", "tj maxx", "ross", "dollar general", "dollar tree",
  "waste management", "republic services", "cintas", "sysco",
  "pepsi", "coca-cola", "frito-lay", "general mills",
];

function isKnownFairChance(company: string): boolean {
  const lower = company.toLowerCase();
  return KNOWN_FAIR_CHANCE_EMPLOYERS.some((fc) => lower.includes(fc));
}

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
  location: string
): Promise<EnrichedJob[]> {
  const uid = process.env.CAREERONESTOP_USER_ID;
  const tok = process.env.CAREERONESTOP_TOKEN;
  if (!uid || !tok) return [];

  const kw = encodeURIComponent(keyword || "jobs");
  const loc = encodeURIComponent(location || "United States");
  // v1/jobsearch/{userId}/{keyword}/{location}/{radius}/{sort}/{order}/{start}/{pageSize}/{days}
  const url = `https://api.careeronestop.org/v1/jobsearch/${uid}/${kw}/${loc}/25/0/0/0/15/30`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      console.error(`CareerOneStop API error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const jobs: CareerOneStopJob[] = data?.Jobs ?? [];
    return jobs.slice(0, 15).map((j, i) => {
      const company = j.Company || "Employer";
      const fair = isKnownFairChance(company);
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
        fair_chance_reason: fair ? "Known fair-chance employer" : null,
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
  context: { hasRecord: boolean; recordType?: string; location: string }
): Promise<{ enrichedJobs: EnrichedJob[]; fairChanceInfo: string }> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Pre-process: build basic enriched jobs without AI
  const basicJobs: EnrichedJob[] = jobs.slice(0, 15).map((j) => {
    const salary = formatSalary(j);
    const posted = formatPosted(j.job_posted_at_datetime_utc);

    return {
      id: j.job_id,
      title: j.job_title,
      company: j.employer_name,
      location: [j.job_city, j.job_state].filter(Boolean).join(", "),
      salary,
      description: truncateDescription(j.job_description, 200),
      full_description: truncateDescription(j.job_description, 2000),
      requirements: j.job_highlights?.Qualifications?.slice(0, 3) ?? [],
      benefits: j.job_highlights?.Benefits?.slice(0, 3) ?? [],
      employment_type: j.job_employment_type || "Full-time",
      posted,
      second_chance: isKnownFairChance(j.employer_name),
      fair_chance_reason: isKnownFairChance(j.employer_name)
        ? "This company has publicly committed to fair-chance hiring."
        : null,
      remote: j.job_is_remote,
      apply_url: j.job_apply_link || j.job_google_link || null,
      employer_website: j.employer_website || null,
    };
  });

  // If no API key, return basic enrichment
  if (!apiKey) {
    return { enrichedJobs: basicJobs, fairChanceInfo: "" };
  }

  // AI enrichment: simplify descriptions + add fair-chance context
  try {
    const jobSummaries = basicJobs.map((j, i) => ({
      index: i,
      title: j.title,
      company: j.company,
      description: j.description,
      known_fair_chance: j.second_chance,
    }));

    const prompt = `You are a reentry employment specialist. Simplify these job listings for someone with a criminal record looking for work in ${sanitizeForPrompt(context.location)}.

JOBS:
${JSON.stringify(jobSummaries)}

Return JSON:
{
  "jobs": [
    {
      "index": 0,
      "simple_description": "What this job involves in plain language. 1-2 sentences. 6th grade reading level.",
      "second_chance": true/false,
      "fair_chance_reason": "Why this employer is good for someone with a record, or null"
    }
  ],
  "fair_chance_info": "1-2 sentences about fair-chance hiring laws in ${sanitizeForPrompt(context.location)}. Mention Wisconsin's ban-the-box law if applicable."
}

RULES:
- Mark second_chance: true for companies known to hire people with records
- Keep descriptions simple and actionable
- 6th grade reading level
- JSON only, no markdown`;

    let text: string;
    try {
      text = await callAI("", [{ role: "user", content: prompt }], 2000);
    } catch {
      return { enrichedJobs: basicJobs, fairChanceInfo: "" };
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const enrichment = JSON.parse(jsonMatch[0]);

      // Merge enrichment back into basic jobs
      for (const ej of enrichment.jobs ?? []) {
        const job = basicJobs[ej.index];
        if (job) {
          if (ej.simple_description) job.description = ej.simple_description;
          if (ej.second_chance) job.second_chance = true;
          if (ej.fair_chance_reason) job.fair_chance_reason = ej.fair_chance_reason;
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

function truncateDescription(desc: string, maxLen: number): string {
  if (!desc) return "";
  // Strip HTML tags
  const clean = desc.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen).replace(/\s\S*$/, "") + "...";
}

// ─── Handler ────────────────────────────────────────────────────────────────

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  if (isMockEnabled()) {
    return NextResponse.json(MOCK_JOB_RESULTS);
  }

  try {
    const { targetRole, location, skills, hasRecord, recordType } =
      await request.json();

    const tenantGeo = getTenantConfig().geo;
    const searchLocation = sanitizeForPrompt(location) || tenantGeo.primaryLocations[0];

    // Build cache key from search params
    const cacheParams = {
      role: sanitizeForPrompt(targetRole),
      location: searchLocation,
    };
    const queryHash = hashQuery(cacheParams);

    // 1. Check cache
    const cached = await getCachedResults(queryHash);
    if (cached) {
      return NextResponse.json({
        jobs: cached.results,
        fair_chance_info: cached.fair_chance_info,
        source: "cache",
      });
    }

    // 2. Fetch from JSearch
    const rawJobs = await fetchJSearchJobs(
      sanitizeForPrompt(targetRole) || "jobs",
      searchLocation,
      tenantGeo.searchRadiusMiles
    );

    if (rawJobs.length === 0) {
      // Fallback to CareerOneStop (DOL) -- free + official. Env-gated, fail-safe.
      const cosJobs = await fetchCareerOneStopJobs(
        sanitizeForPrompt(targetRole) || "jobs",
        searchLocation
      );
      if (cosJobs.length > 0) {
        cosJobs.sort((a, b) =>
          a.second_chance === b.second_chance ? 0 : a.second_chance ? -1 : 1
        );
        await cacheResults(queryHash, cacheParams, cosJobs, "");
        return NextResponse.json({
          jobs: cosJobs,
          fair_chance_info: "",
          source: "careeronestop",
        });
      }
      return NextResponse.json({
        jobs: [],
        fair_chance_info: "",
        source: "jsearch",
      });
    }

    // 3. Enrich with AI (fair-chance flags + simplified descriptions)
    const { enrichedJobs, fairChanceInfo } = await enrichJobsWithAI(rawJobs, {
      hasRecord,
      recordType,
      location: searchLocation,
    });

    // 4. Sort: fair-chance first, then by recency
    enrichedJobs.sort((a, b) => {
      if (a.second_chance && !b.second_chance) return -1;
      if (!a.second_chance && b.second_chance) return 1;
      return 0;
    });

    // 5. Cache results (including fair_chance_info so cache hits return complete data)
    await cacheResults(queryHash, cacheParams, enrichedJobs, fairChanceInfo);

    // 6. Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "job-search",
        modelProvider: `jsearch+${AI_PROVIDER}`,
        modelId: `jsearch-v1+${AI_MODEL}`,
        input: JSON.stringify({ targetRole, location, skills, hasRecord }).slice(0, 500),
        explanation: `JSearch API: ${rawJobs.length} raw results for "${targetRole || "general"}" in ${searchLocation}. ${AI_PROVIDER} enriched ${enrichedJobs.length} listings. Fair-chance: ${enrichedJobs.filter((j) => j.second_chance).length}.`,
        outputSummary: {
          type: "job_search",
          source: "jsearch",
          raw_count: rawJobs.length,
          enriched_count: enrichedJobs.length,
          second_chance_count: enrichedJobs.filter((j) => j.second_chance).length,
        },
      });
    } catch (err) {
      console.error("Decision log failed (job-search):", err);
    }

    return NextResponse.json({
      jobs: enrichedJobs,
      fair_chance_info: fairChanceInfo,
      source: "jsearch",
    });
  } catch (error) {
    console.error("Job search error:", error);
    return NextResponse.json({ jobs: [], fair_chance_info: "" });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "jobs",
  requiredTier: "client",
});
