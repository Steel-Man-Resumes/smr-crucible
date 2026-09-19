/**
 * Job providers — Adzuna and USAJOBS, normalized into the JSearch record shape.
 *
 * WHY NORMALIZE INTO JSearchJob RATHER THAN A NEW SHAPE:
 * everything downstream of the fetch (AI enrichment, the verified fair-chance
 * employer match, dedupe, sorting, caching, decision logging) already speaks
 * that shape. Mapping into it means a second and third source light up the
 * whole existing pipeline without touching the parts that are already correct,
 * which is the smallest possible blast radius.
 *
 * WHY THESE EXIST AT ALL (measured 2026-09-19, live):
 * JSearch is the only job source this app has ever had, and it stalls
 * intermittently on arbitrary queries -- 3 of 7 single attempts hung past 15s
 * in one sample, Milwaukee as readily as Montana, with zero HTTP errors (so not
 * a key, quota, or billing fault). CareerOneStop, the nominal fallback, returns
 * 401 because the account is not entitled to its jobsearch endpoint. A retry
 * ladder covers most of it, but one provider retried is still one provider.
 *
 * Measured on the same Montana queries JSearch struggles with:
 *   Adzuna  7/7 searches, 166-417ms
 *   JSearch 4/7 searches, 2,000-15,000ms
 */

import type { JSearchJob } from "./job-search-core";

export interface ProviderResult {
  jobs: JSearchJob[];
  failed: boolean;
  status?: number;
}

const EMPTY: ProviderResult = { jobs: [], failed: true };

async function getJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, json: null };
    return { ok: true, status: res.status, json: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Adzuna ─────────────────────────────────────────────────────────────────

interface AdzunaResult {
  id?: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  description?: string;
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
  created?: string;
  redirect_url?: string;
}

/**
 * Adzuna's `area` is ordered broad -> narrow, e.g.
 *   ["US", "Montana", "Silver Bow County", "Rocker"]
 * so the state is area[1] and the most specific place is the last element.
 * Its `location.display_name` is "City, County" ("Rocker, Silver Bow County"),
 * which would render a Montana job without the word Montana anywhere on it.
 */
function adzunaPlace(loc: AdzunaResult["location"]): { city: string; state: string } {
  const area = loc?.area ?? [];
  const state = area.length > 1 ? area[1] : "";
  const city = area.length > 2 ? area[area.length - 1] : (loc?.display_name ?? "");
  return { city, state };
}

export async function fetchAdzunaJobs(
  role: string,
  location: string,
  radiusMiles: number,
  timeoutMs: number
): Promise<ProviderResult> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { jobs: [], failed: false }; // not configured is not a failure

  const url = new URL("https://api.adzuna.com/v1/api/jobs/us/search/1");
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("what", role || "jobs");
  url.searchParams.set("where", location);
  url.searchParams.set("distance", String(radiusMiles));
  url.searchParams.set("results_per_page", "15");
  url.searchParams.set("content-type", "application/json");

  try {
    const res = await getJson(url.toString(), {}, timeoutMs);
    if (!res.ok) {
      console.error(`[job-search] Adzuna error: ${res.status}`);
      return { jobs: [], failed: true, status: res.status };
    }
    const results = ((res.json as { results?: AdzunaResult[] })?.results ?? []);
    const jobs: JSearchJob[] = results.map((r, i) => {
      const { city, state } = adzunaPlace(r.location);
      return {
        job_id: `adzuna-${r.id ?? i}`,
        job_title: r.title ?? "Job",
        employer_name: r.company?.display_name ?? "Employer",
        employer_logo: null,
        job_city: city,
        job_state: state,
        job_country: "US",
        job_description: r.description ?? "",
        job_min_salary: r.salary_min ?? null,
        job_max_salary: r.salary_max ?? null,
        job_salary_currency: "USD",
        job_salary_period: "YEAR",
        job_employment_type: r.contract_time === "part_time" ? "Part-time" : "Full-time",
        job_posted_at_datetime_utc: r.created ?? "",
        job_is_remote: false,
        employer_website: null,
        job_apply_link: r.redirect_url ?? null,
      };
    });
    return { jobs, failed: false };
  } catch (err) {
    console.error("[job-search] Adzuna fetch failed:", err);
    return EMPTY;
  }
}

// ─── USAJOBS ────────────────────────────────────────────────────────────────

interface UsaJobsItem {
  MatchedObjectDescriptor?: {
    PositionID?: string;
    PositionTitle?: string;
    OrganizationName?: string;
    PositionURI?: string;
    ApplyURI?: string[];
    PositionLocation?: { LocationName?: string; CityName?: string; CountrySubDivisionName?: string }[];
    PositionRemuneration?: { MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }[];
    PositionSchedule?: { Name?: string }[];
    PublicationStartDate?: string;
    UserArea?: { Details?: { JobSummary?: string } };
  };
}

/**
 * Federal postings are often open in many places at once -- one real listing
 * carried 432 locations, six of them in Montana. Taking PositionLocation[0]
 * would show a Helena-eligible job as "Saint Croix, Virgin Islands", so pick
 * the location in the state the person actually searched. Falls back to the
 * first concrete location, and finally to whatever was searched.
 */
function pickLocationInState(
  locations: { LocationName?: string }[],
  stateFullName: string
): { city: string; state: string } {
  const names = locations.map((l) => l.LocationName ?? "").filter(Boolean);
  const inState = stateFullName
    ? names.find((n) => n.toLowerCase().endsWith(`, ${stateFullName.toLowerCase()}`))
    : undefined;
  const chosen = inState ?? names.find((n) => !/remote/i.test(n)) ?? names[0] ?? "";
  const parts = chosen.split(",").map((s) => s.trim());
  return { city: parts[0] ?? "", state: parts[1] ?? stateFullName };
}

export async function fetchUsaJobs(
  role: string,
  stateFullName: string,
  timeoutMs: number
): Promise<ProviderResult> {
  const key = process.env.USAJOBS_API_KEY;
  const ua = process.env.USAJOBS_USER_AGENT;
  if (!key || !ua || !stateFullName) return { jobs: [], failed: false };

  // VERIFIED 2026-09-19: LocationName with the FULL STATE NAME is the parameter
  // that actually constrains geography. `PositionLocationCountrySubdivision` and
  // `PositionLocationState` are not real parameters -- both returned the
  // unfiltered 10,000-result ceiling. A city value ("Helena, Montana") matches
  // mostly work-anywhere remote postings, which is not what a rural job seeker
  // in that town is asking for.
  const url = new URL("https://data.usajobs.gov/api/search");
  if (role) url.searchParams.set("Keyword", role);
  url.searchParams.set("LocationName", stateFullName);
  url.searchParams.set("ResultsPerPage", "15");

  try {
    const res = await getJson(
      url.toString(),
      { headers: { Host: "data.usajobs.gov", "User-Agent": ua, "Authorization-Key": key } },
      timeoutMs
    );
    if (!res.ok) {
      console.error(`[job-search] USAJOBS error: ${res.status}`);
      return { jobs: [], failed: true, status: res.status };
    }
    const items =
      ((res.json as { SearchResult?: { SearchResultItems?: UsaJobsItem[] } })?.SearchResult
        ?.SearchResultItems ?? []);

    const jobs: JSearchJob[] = items.flatMap((it, i) => {
      const d = it.MatchedObjectDescriptor;
      if (!d) return [];
      const locs = d.PositionLocation ?? [];
      // Drop postings with no actual presence in the searched state. A
      // work-anywhere remote listing is not a local opening, and showing it as
      // one would misrepresent the local labor market.
      const hasInState = locs.some((l) =>
        (l.LocationName ?? "").toLowerCase().endsWith(`, ${stateFullName.toLowerCase()}`)
      );
      if (!hasInState) return [];

      const { city, state } = pickLocationInState(locs, stateFullName);
      const pay = d.PositionRemuneration?.[0];
      const perYear = pay?.RateIntervalCode === "PA";
      return [{
        job_id: `usajobs-${d.PositionID ?? i}`,
        job_title: d.PositionTitle ?? "Job",
        employer_name: d.OrganizationName ?? "Federal Agency",
        employer_logo: null,
        job_city: city,
        job_state: state,
        job_country: "US",
        job_description: d.UserArea?.Details?.JobSummary ?? "",
        job_min_salary: pay?.MinimumRange ? Number(pay.MinimumRange) : null,
        job_max_salary: pay?.MaximumRange ? Number(pay.MaximumRange) : null,
        job_salary_currency: "USD",
        job_salary_period: perYear ? "YEAR" : "HOUR",
        job_employment_type: d.PositionSchedule?.[0]?.Name ?? "Full-time",
        job_posted_at_datetime_utc: d.PublicationStartDate ?? "",
        job_is_remote: false,
        employer_website: null,
        job_apply_link: d.ApplyURI?.[0] ?? d.PositionURI ?? null,
      }];
    });
    return { jobs, failed: false };
  } catch (err) {
    console.error("[job-search] USAJOBS fetch failed:", err);
    return EMPTY;
  }
}

// ─── Merge ──────────────────────────────────────────────────────────────────

function dedupeKey(j: JSearchJob): string {
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${norm(j.job_title)}|${norm(j.employer_name)}|${norm(j.job_city)}`;
}

/**
 * Merge in the order given, keeping the first occurrence of each
 * title+employer+city. The same posting is syndicated across aggregators, and a
 * board that shows one job three times reads as broken.
 *
 * `preferState` (a full state name) floats in-state listings to the top without
 * discarding anything. Rural searches legitimately cross state lines -- a 50-mile
 * ring around Libby, MT reaches Idaho -- and those jobs are real and worth
 * showing. But a person searching their own town should not open the board to
 * another state's listings, so out-of-state results follow rather than lead.
 * Order within each group is preserved, so the provider priority above still
 * holds.
 */
export function mergeJobs(lists: JSearchJob[][], preferState?: string): JSearchJob[] {
  const seen = new Set<string>();
  const out: JSearchJob[] = [];
  for (const list of lists) {
    for (const j of list) {
      const k = dedupeKey(j);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(j);
    }
  }
  if (!preferState) return out;
  const want = preferState.toLowerCase();
  const inState = out.filter((j) => (j.job_state ?? "").toLowerCase() === want);
  const rest = out.filter((j) => (j.job_state ?? "").toLowerCase() !== want);
  return [...inState, ...rest];
}
