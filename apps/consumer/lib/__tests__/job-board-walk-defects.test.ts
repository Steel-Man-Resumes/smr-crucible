/**
 * Defects from the 2026-10-24 production walk of the job board (Milwaukee, WI),
 * replayed against saved provider responses. No live provider is called: fetch
 * is replaced and serves the fixture by host and query.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJobSearch } from "../job-search-core";
import { mapAdzunaJob, mapUsaJobsJob, mergeJobs, jsearchUrl } from "../job-providers";
import { normalizeLocation } from "../job-location";
import { evidenceForJob, formatSourceSalary } from "../job-search-evidence";
import { searchRoles, jobRelevance, relatedTerms } from "../job-search-relevance";
import { defaultJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import type { JSearchJob } from "../job-search-types";

const F = JSON.parse(readFileSync(join(__dirname, "fixtures", "job-board-walk-2026-10-24.json"), "utf8"));
const KEYS = ["JSEARCH_API_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "USAJOBS_API_KEY", "USAJOBS_USER_AGENT", "OPENAI_API_KEY", "MOCK_AI", "DATABASE_URL"];
type Route = (provider: "jsearch" | "adzuna" | "usajobs", role: string) => { status: number; body: unknown };
async function withProviders<T>(route: Route, run: (calls: URL[]) => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.JSEARCH_API_KEY = "synthetic"; process.env.ADZUNA_APP_ID = "synthetic"; process.env.ADZUNA_APP_KEY = "synthetic";
  process.env.USAJOBS_API_KEY = "synthetic"; process.env.USAJOBS_USER_AGENT = "synthetic@example.com";
  const original = globalThis.fetch, calls: URL[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input)); calls.push(url);
    const provider = url.hostname.startsWith("jsearch") ? "jsearch" : url.hostname.includes("adzuna") ? "adzuna" : url.hostname.includes("usajobs") ? "usajobs" : null;
    if (!provider) throw new Error(`unexpected host in test: ${url.hostname}`);
    const role = provider === "jsearch" ? String(url.searchParams.get("query")).replace(/ in .*$/, "") : provider === "adzuna" ? String(url.searchParams.get("what")) : String(url.searchParams.get("Keyword") || "");
    const { status, body } = route(provider, role);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try { return await run(calls); } finally {
    globalThis.fetch = original;
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const fixtureRoute: Route = (provider, role) => {
  const body = F[provider]?.[role];
  return body ? { status: 200, body } : { status: 200, body: provider === "jsearch" ? { data: { jobs: [], cursor: null } } : provider === "adzuna" ? { results: [] } : { SearchResult: { SearchResultItems: [] } } };
};
const search = (role: string) => runJobSearch({ role, location: "Milwaukee, WI", userId: null, filters: { radiusMiles: { value: null } } });

test("(a) warehouse lead: unrelated pharmacist and consulting jobs are dropped and counted, a description-only match goes to the also-found fold", async () => {
  const result = await withProviders(fixtureRoute, () => search("warehouse lead"));
  const titles = result.jobs.map(j => j.title);
  assert.ok(!titles.some(t => /Pharmacist/.test(t)), "pharmacist dropped");
  assert.ok(!titles.some(t => /Amazon Connect/.test(t)), "contact center manager dropped");
  assert.equal(result.summary?.offTopic, 2);
  assert.equal(result.summary?.excludedBy.off_topic, 2);
  assert.ok(result.summary?.notices.some(n => /2 loaded listings left out because none of your search words/.test(n)), "drop is said on screen, not silent");
  const data = result.jobs.find(j => /Data Engineering/.test(j.title));
  assert.equal(data?.relevance?.tier, "description", "data warehouse posting kept only in the fold");
  assert.equal(result.summary?.alsoFound, 1);
  assert.equal(result.jobs.at(-1)?.relevance?.tier, "description", "fold listings sort after title matches");
  assert.match(result.jobs[0].title, /Warehouse/);
  assert.equal(result.jobs[0].relevance?.tier, "title");
});

test("(b) one posting listed per town and the same posting from two providers collapse into one card with its other locations", async () => {
  const result = await withProviders(fixtureRoute, () => search("warehouse lead"));
  const plastics = result.jobs.filter(j => /Example Plastics/.test(j.company));
  assert.equal(plastics.length, 1, "three towns, one card");
  assert.equal(plastics[0].location, "Milwaukee, WI", "card shows the searched city when the posting is listed there");
  assert.deepEqual(plastics[0].other_locations?.sort(), ["Germantown, WI", "Menomonee Falls, WI"]);
  const logistics = result.jobs.filter(j => /Example Logistics/.test(j.company));
  assert.equal(logistics.length, 1, "JSearch and Adzuna copies of one posting are one card");
  assert.equal(logistics[0].source_variants?.[0].source, "adzuna", "provenance kept");
  const wholeTown = mergeJobs([Array.from({ length: 11 }, (_, i) => ({ ...F.jsearch["warehouse lead"].data.jobs[3], job_id: `town-${i}`, job_city: `Town ${i}`, job_apply_link: `https://jobs.example.com/t/${i}` }))]);
  assert.equal(wholeTown.length, 1); assert.equal(wholeTown[0].job_locations?.length, 10);
  const different = mergeJobs([[F.jsearch["warehouse lead"].data.jobs[0], { ...F.jsearch["warehouse lead"].data.jobs[0], job_id: "other", job_title: "Forklift Operator" }]]);
  assert.equal(different.length, 2, "different titles at one employer stay separate, even with one shared careers link");
  const sameId = mergeJobs([[F.jsearch["warehouse lead"].data.jobs[0]], [{ ...F.jsearch["warehouse lead"].data.jobs[0], job_title: "Warehouse Lead (2nd shift)" }]]);
  assert.equal(sameId.length, 1, "a repeated provider id is one posting");
});

test("(c) pay shows only with currency and period; no placeholder text on any card", async () => {
  const result = await withProviders(fixtureRoute, () => search("warehouse lead"));
  for (const job of result.jobs) {
    assert.doesNotMatch(job.salary || "", /not supplied/i);
    assert.doesNotMatch(JSON.stringify(job.evidence?.warnings || []), /not supplied|comparable pay period/i);
  }
  assert.equal(result.jobs.find(j => j.company === "Example Logistics")?.salary, "USD 22 to 26 / hour");
  assert.equal(result.jobs.find(j => /Data Engineering/.test(j.title))?.salary, null, "70,856.24 with no currency or period is not shown");
  assert.equal(result.jobs.find(j => /Example Plastics/.test(j.company))?.salary, null, "bare 6,240 is not shown");
  const adzuna = mapAdzunaJob(F.adzuna["warehouse lead"].results[0]);
  assert.equal(formatSourceSalary(evidenceForJob(adzuna).salary), null);
  const federal = mapUsaJobsJob(F.usajobs["warehouse lead"].SearchResult.SearchResultItems[0], 0, "Milwaukee, WI")!;
  assert.equal(formatSourceSalary(evidenceForJob(federal).salary), "USD 120,000 to 160,000 / year");
});

test("(d) locations never repeat the state or country", async () => {
  assert.equal(normalizeLocation("Milwaukee, Wisconsin", "Wisconsin"), "Milwaukee, Wisconsin");
  assert.equal(normalizeLocation("Anywhere in the U.S. (remote job), United States", "United States"), "Anywhere in the U.S. (remote job), United States");
  assert.equal(normalizeLocation("Milwaukee", "WI, Wisconsin"), "Milwaukee, WI");
  assert.equal(normalizeLocation("Milwaukee", "WI"), "Milwaukee, WI");
  const az = mapAdzunaJob(F.adzuna["warehouse lead"].results[1]);
  assert.equal(normalizeLocation(az.job_city, az.job_state), "Milwaukee, Wisconsin");
  const usa = mapUsaJobsJob(F.usajobs_location, 0, "Milwaukee, WI")!;
  assert.equal(usa.job_city, "Milwaukee"); assert.equal(usa.job_state, "Wisconsin");
  const result = await withProviders(fixtureRoute, () => search("warehouse lead"));
  for (const job of result.jobs) assert.doesNotMatch(job.location, /(\b[\w .()]+), \1\b/i, job.location);
  assert.equal(result.jobs.find(j => j.company === "Example Foods")?.location, "Milwaukee, Wisconsin");
});

test("(e) trade terms add a related search, original first, and say so on screen", async () => {
  assert.deepEqual(searchRoles("rigger", "", []), ["rigger", "rigging"]);
  assert.deepEqual(searchRoles("shipping and receiving lead", "", []), ["shipping and receiving lead", "shipping receiving supervisor"]);
  assert.deepEqual(relatedTerms("Shipping & Receiving Lead"), ["shipping receiving supervisor", "shipping receiving"]);
  assert.deepEqual(searchRoles("Cook", "", []), ["Cook"], "no related term invented for a term without one");
  const rigging: Route = (provider, role) => provider === "jsearch" && role === "rigging"
    ? { status: 200, body: { data: { cursor: null, jobs: [{ job_id: "rg-1", job_title: "Crane Rigging Technician", employer_name: "Example Cranes", employer_logo: null, job_city: "Milwaukee", job_state: "WI", job_country: "US", job_description: "Set loads and signal crane operators.", job_min_salary: null, job_max_salary: null, job_salary_currency: null, job_salary_period: null, job_employment_type: "FULLTIME", job_posted_at_datetime_utc: "2026-10-22T12:00:00Z", job_is_remote: false, employer_website: null }] } } }
    : fixtureRoute(provider, role);
  const result = await withProviders(rigging, async calls => {
    const r = await search("rigger");
    const queries = calls.filter(u => u.hostname.startsWith("jsearch")).map(u => u.searchParams.get("query"));
    assert.deepEqual(queries, ["rigger in Milwaukee, WI", "rigging in Milwaukee, WI"], "original term is sent first and verbatim");
    return r;
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].relevance?.matchedRelatedOnly, true);
  assert.match(result.jobs[0].relevance!.reason, /related term \(rigging\), not your exact words/);
  assert.deepEqual(result.summary?.relatedTerms, ["rigging"]);
  assert.ok(result.summary?.notices.some(n => /also searched "rigging", a related term for "rigger"/.test(n)));
  assert.equal(jsearchUrl("rigger", "Milwaukee, WI", defaultJobSearchFilters()).searchParams.get("query"), "rigger in Milwaukee, WI");
});

test("(f) general boards down plus a clean federal zero is a source outage, not an empty market", async () => {
  const down: Route = provider => provider === "usajobs" ? { status: 200, body: { SearchResult: { SearchResultItems: [] } } } : { status: 503, body: { error: "synthetic" } };
  const result = await withProviders(down, () => search("rigger"));
  assert.equal(result.error, "provider_unavailable");
  assert.equal(result.jobs.length, 0);
  const limited: Route = provider => provider === "usajobs" ? { status: 200, body: { SearchResult: { SearchResultItems: [] } } } : { status: 429, body: {} };
  assert.equal((await withProviders(limited, () => search("rigger"))).error, "provider_rate_limited");
  const oneDown: Route = (provider, role) => provider === "adzuna" ? { status: 503, body: {} } : fixtureRoute(provider, role);
  const partial = await withProviders(oneDown, () => search("warehouse lead"));
  assert.equal(partial.error, undefined);
  assert.ok(partial.summary?.notices.some(n => /^Adzuna did not answer this search/.test(n)), "the missing source is named");
  const cleanEmpty: Route = provider => ({ status: 200, body: provider === "jsearch" ? { data: { jobs: [], cursor: null } } : provider === "adzuna" ? { results: [] } : { SearchResult: { SearchResultItems: [] } } });
  const empty = await withProviders(cleanEmpty, () => search("rigger"));
  assert.equal(empty.error, undefined, "boards that answered with nothing are an honest zero");
});

test("relevance tiers: level words alone do not make a match; plurals do", () => {
  const roles = ["warehouse lead"];
  assert.equal(jobRelevance({ title: "Lead Pharmacist", full_description: "Lead the pharmacy team." }, roles, []).tier, "none");
  assert.equal(jobRelevance({ title: "Riggers Needed", full_description: "" }, ["rigger"], []).tier, "title");
  assert.equal(jobRelevance({ title: "Anything", full_description: "x" }, [], []).tier, "title", "no search words means no filtering");
  const job: JSearchJob = F.jsearch["warehouse lead"].data.jobs[0];
  assert.equal(jobRelevance({ title: job.job_title, full_description: job.job_description }, roles, []).tier, "title");
});
