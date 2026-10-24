/**
 * Defects from the 2026-10-24 production walk of the job board (Milwaukee, WI),
 * replayed against saved provider responses. No live provider is called: fetch
 * is replaced and serves the fixture by host and query.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJobSearch, basicJob, providerFailureNotices, CACHE_MINUTES_DEGRADED, CACHE_MINUTES_HEALTHY } from "../job-search-core";
import { normalizeEmployerName, _resetMarkCaches, type EmployerMarks } from "@crucible/core";
import { mapAdzunaJob, mapUsaJobsJob, mergeJobs, jsearchUrl } from "../job-providers";
import { normalizeLocation } from "../job-location";
import { coachJobView } from "../job-coach-view";
import { evidenceForJob, formatSourceSalary } from "../job-search-evidence";
import { searchRoles, searchPlan, jobRelevance, relatedTerms } from "../job-search-relevance";
import { defaultJobSearchFilters } from "@crucible/core/src/jobSearchFilters";
import type { JSearchJob } from "../job-search-types";

const F = JSON.parse(readFileSync(join(__dirname, "fixtures", "job-board-walk-2026-10-24.json"), "utf8"));
const KEYS = ["JSEARCH_API_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "USAJOBS_API_KEY", "USAJOBS_USER_AGENT", "OPENAI_API_KEY", "MOCK_AI", "DATABASE_URL"];
type Route = (provider: "jsearch" | "adzuna" | "usajobs", role: string) => { status: number; body: unknown };
interface DbCall { query: string; params: unknown[] }
/** Rows served for a cache read, as [results, fair_chance_info, query_params]. Null means a cache miss. */
let cacheRow: [unknown, string, unknown] | null = null;
async function withProviders<T>(route: Route, run: (calls: URL[], db: DbCall[]) => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.JSEARCH_API_KEY = "synthetic"; process.env.ADZUNA_APP_ID = "synthetic"; process.env.ADZUNA_APP_KEY = "synthetic";
  process.env.USAJOBS_API_KEY = "synthetic"; process.env.USAJOBS_USER_AGENT = "synthetic@example.com";
  // The Neon HTTP driver runs over fetch, so the database is served here too:
  // cache reads get cacheRow, writes are recorded, anything else gets no rows.
  process.env.DATABASE_URL = "postgresql://synthetic:synthetic@ep-synthetic-test.us-east-2.aws.neon.tech/db";
  _resetMarkCaches();
  const original = globalThis.fetch, calls: URL[] = [], db: DbCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith("neon.tech")) {
      const call = JSON.parse(String(init?.body)) as DbCall; db.push(call);
      const read = /^\s*SELECT results, fair_chance_info, query_params FROM job_search_cache/.test(call.query);
      const rows = read && cacheRow ? [[JSON.stringify(cacheRow[0]), cacheRow[1], JSON.stringify(cacheRow[2])]] : [];
      return new Response(JSON.stringify({ command: read ? "SELECT" : "INSERT", fields: read ? [{ name: "results", dataTypeID: 3802 }, { name: "fair_chance_info", dataTypeID: 25 }, { name: "query_params", dataTypeID: 3802 }] : [], rows, rowCount: rows.length, rowAsArray: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    calls.push(url);
    const provider = url.hostname.startsWith("jsearch") ? "jsearch" : url.hostname.includes("adzuna") ? "adzuna" : url.hostname.includes("usajobs") ? "usajobs" : null;
    if (!provider) throw new Error(`unexpected host in test: ${url.hostname}`);
    const role = provider === "jsearch" ? String(url.searchParams.get("query")).replace(/ in .*$/, "") : provider === "adzuna" ? String(url.searchParams.get("what")) : String(url.searchParams.get("Keyword") || "");
    const { status, body } = route(provider, role);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try { return await run(calls, db); } finally {
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
  assert.equal(logistics[0].other_locations, undefined, "Milwaukee, WI and Milwaukee, Wisconsin are one place, not 2 locations");
  assert.deepEqual(logistics[0].other_listings, [{ place: "Milwaukee, Wisconsin", apply_url: "https://www.adzuna.com/details/az-1", source: "adzuna" }], "the second copy keeps its own apply link");
  assert.equal(plastics[0].other_listings?.length, 2);
  assert.ok(plastics[0].other_listings?.every(l => /jobs\.example\.com\/plastics\//.test(l.apply_url || "")), "each town keeps its own apply link");
  const wholeTown = mergeJobs([Array.from({ length: 11 }, (_, i) => ({ ...F.jsearch["warehouse lead"].data.jobs[3], job_id: `town-${i}`, job_city: `Town ${i}`, job_apply_link: `https://jobs.example.com/t/${i}` }))]);
  assert.equal(wholeTown.length, 1); assert.equal(wholeTown[0].job_listings?.length, 10);
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
  assert.deepEqual(searchRoles("shipping and receiving lead", "", []), ["shipping and receiving lead", "Material handler"], "the job family search keeps the second slot");
  assert.deepEqual(searchRoles("warehouse lead", "", []), ["warehouse lead", "Material handler"]);
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

const listing = (change: Partial<JSearchJob>): JSearchJob => ({ ...F.jsearch["warehouse lead"].data.jobs[0], source: "jsearch", ...change });

test("S4: one provider, one city, different apply links are two openings; placeholder employers never merge; picked copy matches city and state", () => {
  const twoOpenings = mergeJobs([[listing({ job_id: "a1", job_apply_link: "https://jobs.example.com/a/1" }), listing({ job_id: "a2", job_apply_link: "https://jobs.example.com/a/2" })]]);
  assert.equal(twoOpenings.length, 2, "same title, same city, different links from one provider");
  const sameLink = mergeJobs([[listing({ job_id: "b1" }), listing({ job_id: "b2" })]]);
  assert.equal(sameLink.length, 1, "same link is the same opening");
  const placeholder = mergeJobs([[listing({ job_id: "p1", employer_name: "Employer", job_city: "Milwaukee" }), listing({ job_id: "p2", employer_name: "Employer", job_city: "Waukesha" })]]);
  assert.equal(placeholder.length, 2, "unknown employers are not one company");
  const kc = mergeJobs([[listing({ job_id: "k1", job_city: "Kansas City", job_state: "KS", job_apply_link: "https://jobs.example.com/kc/ks" }), listing({ job_id: "k2", job_city: "Kansas City", job_state: "MO", job_apply_link: "https://jobs.example.com/kc/mo" })]], "Kansas City, MO");
  assert.equal(kc.length, 1); assert.equal(kc[0].job_state, "MO", "the shown copy matches city and state");
  assert.equal(kc[0].job_listings?.[0].apply_url, "https://jobs.example.com/kc/ks");
});

test("Mark after merge: a record mark earned in any merged town stays on the card and names that town", () => {
  const [merged] = mergeJobs([[listing({ job_id: "m1", employer_name: "Example Plastics", job_city: "Milwaukee", job_apply_link: "https://jobs.example.com/m/1" }), listing({ job_id: "m2", employer_name: "Example Plastics", job_city: "Germantown", job_apply_link: "https://jobs.example.com/m/2" })]], "Milwaukee, WI");
  assert.equal(merged.job_city, "Milwaukee");
  const marks: EmployerMarks = { source: "directory", byKey: new Map([[normalizeEmployerName("Example Plastics"), [{ basis: "employer", roleFamily: null, roleTitle: null, placeKind: "site", state: "WI", county: null, city: "Germantown" }]]]) };
  const card = basicJob(merged, marks);
  assert.equal(card.second_chance, false, "the Milwaukee card is not marked: only Germantown was checked");
  assert.equal(card.fair_chance_reason, null);
  assert.equal(card.marked_elsewhere?.town, "Germantown, WI");
  assert.match(card.marked_elsewhere?.reason || "", /in Germantown, WI\. We did not check Milwaukee, WI\./);
  const coach = coachJobView(card);
  assert.deepEqual({ checkedAt: coach.recordMark?.checkedAt, notCheckedAt: (coach.recordMark as { notCheckedAt?: string })?.notCheckedAt }, { checkedAt: "Germantown, WI", notCheckedAt: "Milwaukee, WI" }, "t.ROY gets the checked town, not a bare true");
  assert.ok(!JSON.stringify(coach).includes('"fairChance":true'));
  const here = basicJob(merged, { source: "directory", byKey: new Map([[normalizeEmployerName("Example Plastics"), [{ basis: "employer", roleFamily: null, roleTitle: null, placeKind: "site", state: "WI", county: null, city: "Milwaukee" }]]]) });
  assert.equal(here.second_chance, true); assert.match(here.fair_chance_reason || "", /here\.$/); assert.equal(here.marked_elsewhere, undefined);
  assert.equal(coachJobView(here).recordMark?.checkedAt, "Milwaukee, WI");
  assert.equal(basicJob(merged, { source: "directory", byKey: new Map() }).second_chance, false, "no mark is invented");
});

test("S1: general boards down and USAJOBS sending only an off-topic job is still a source outage", async () => {
  const down: Route = provider => provider === "usajobs"
    ? { status: 200, body: { SearchResult: { SearchResultItems: [{ MatchedObjectId: "cs-1", MatchedObjectDescriptor: { PositionTitle: "Contract Specialist", OrganizationName: "Example Agency", PositionLocation: [{ LocationName: "Milwaukee, Wisconsin", CityName: "Milwaukee, Wisconsin", CountrySubDivisionCode: "Wisconsin" }], UserArea: { Details: { JobSummary: "Federal acquisition work." } } } }] } } }
    : { status: 503, body: {} };
  const result = await withProviders(down, () => search("rigger"));
  assert.equal(result.jobs.length, 0);
  assert.equal(result.summary?.excludedBy.off_topic, 1, "the drop is still counted");
  assert.equal(result.error, "provider_unavailable", "the page shows the on-our-side message, not change-your-choices");
  const oneDown: Route = (provider, role) => provider === "adzuna" ? { status: 503, body: {} } : provider === "jsearch" ? { status: 200, body: { data: { jobs: [], cursor: null } } } : fixtureRoute(provider, role);
  assert.equal((await withProviders(oneDown, () => search("warehouse lead"))).error, "provider_partial", "a failed board with nothing kept is not reported as an empty market");
});

test("S2: one failed search of two is named as part of a provider, not the whole provider", async () => {
  assert.deepEqual(providerFailureNotices([{ source: "JSearch", failed: false }, { source: "JSearch", failed: true }, { source: "Adzuna", failed: false }, { source: "Adzuna", failed: false }]), ["One of two JSearch searches did not answer, so some JSearch listings may be missing."]);
  const half: Route = (provider, role) => provider === "jsearch" && role === "rigging" ? { status: 429, body: {} }
    : provider === "jsearch" ? { status: 200, body: { data: { cursor: null, jobs: [listing({ job_id: "rg-2", job_title: "Rigger", employer_name: "Example Cranes" })] } } } : fixtureRoute(provider, role);
  const result = await withProviders(half, () => search("rigger"));
  assert.equal(result.jobs.length, 1);
  assert.ok(result.summary?.notices.includes("One of two JSearch searches did not answer, so some JSearch listings may be missing."));
  assert.ok(!result.summary?.notices.some(n => /^JSearch did not answer/.test(n)), "JSearch did answer the first search");
});

test("S5: a degraded search is cached for 10 minutes with its notices, and a cache hit shows them again", async () => {
  const oneDown: Route = (provider, role) => provider === "adzuna" ? { status: 503, body: {} } : fixtureRoute(provider, role);
  const writeOf = (db: DbCall[]) => db.find(c => /INSERT INTO job_search_cache/.test(c.query));
  const degraded = await withProviders(oneDown, async (_calls, db) => { await search("warehouse lead"); return writeOf(db); });
  assert.equal(Number(degraded?.params[5]), CACHE_MINUTES_DEGRADED);
  assert.equal(CACHE_MINUTES_DEGRADED, 10);
  const stored = JSON.parse(String(degraded?.params[1]));
  assert.equal(stored.version, 4, "server cache version stays bumped");
  assert.ok(stored.searchMetadata.notices.some((n: string) => /^Adzuna did not answer/.test(n)));
  const healthy = await withProviders(fixtureRoute, async (_calls, db) => { await search("warehouse lead"); return writeOf(db); });
  assert.equal(Number(healthy?.params[5]), CACHE_MINUTES_HEALTHY);
  cacheRow = [[], "", stored];
  try {
    const hit = await withProviders(fixtureRoute, async calls => { const r = await search("warehouse lead"); assert.equal(calls.length, 0, "served from cache"); return r; });
    assert.equal(hit.source, "cache");
    assert.ok(hit.summary?.notices.some(n => /^Adzuna did not answer/.test(n)), "the outage notice survives a cache hit");
    assert.equal(hit.error, "provider_partial");
  } finally { cacheRow = null; }
  assert.match(readFileSync(join(__dirname, "..", "..", "app", "(dashboard)", "dashboard", "jobs", "page.tsx"), "utf8"), /job_search:v3:/, "browser cache key stays bumped");
});

test("S3 and generic nouns: family titles stay in the main list; one shared generic noun is not a match", () => {
  const plan = (q: string) => { const p = searchPlan(q, "", []); return (title: string, description = "") => jobRelevance({ title, full_description: description }, p.roles, [], p.related, p.familyTitles).tier; };
  const warehouse = plan("warehouse lead");
  assert.equal(warehouse("Material Handler", "Move pallets."), "title");
  assert.equal(warehouse("Dock Lead", "Run the loading dock."), "title");
  assert.equal(plan("maintenance technician")("Millwright", "Install conveyors."), "title");
  assert.equal(plan("electrician")("Electrical Technician", "Wire panels."), "title");
  assert.equal(plan("rigger")("Crane Rigging Technician"), "title");
  assert.notEqual(plan("forklift operator")("Call Center Operator", "Answer calls."), "title");
  assert.notEqual(plan("forklift operator")("Machine Operator", "Run a press."), "title");
  assert.notEqual(plan("maintenance technician")("Pharmacy Technician", "Fill prescriptions."), "title");
  assert.notEqual(plan("line cook")("Production Line Worker", "Assemble parts."), "title");
  assert.equal(plan("driver")("Delivery Driver"), "title", "a search made only of a generic noun still matches it");
  assert.match(jobRelevance({ title: "Crew Member", full_description: "Rigging work." }, ["rigger", "rigging"], [], ["rigging", "ironworker"]).reason, /A related term \(rigging\)/);
});

test("No pay warning on a card that shows no pay", () => {
  const e = evidenceForJob(listing({ job_min_salary: 20000, job_max_salary: null, job_salary_currency: null, job_salary_period: "HOUR" }));
  assert.equal(formatSourceSalary(e.salary), null);
  assert.deepEqual(e.warnings.filter(w => /pay/i.test(w)), []);
  assert.ok(evidenceForJob(listing({ job_min_salary: 20000, job_salary_currency: "USD", job_salary_period: "HOUR" })).warnings.some(w => /Unusually high/.test(w)));
});

test("R-S1: the person's own choices removing everything is said as that, not as our outage; a full outage keeps the counts", async () => {
  const partTime = listing({ job_id: "pt-1", job_employment_type: "PARTTIME", job_employment_types: ["PARTTIME"] });
  const run = (route: Route) => withProviders(route, () => runJobSearch({ role: "warehouse lead", location: "Milwaukee, WI", userId: null, filters: { radiusMiles: { value: null }, employmentTypes: { value: ["full_time"], mode: "must" }, includeUnknown: false } }));
  const usaDown: Route = (provider, role) => provider === "usajobs" ? { status: 503, body: {} } : provider === "jsearch" && role === "warehouse lead" ? { status: 200, body: { data: { cursor: null, jobs: [partTime] } } } : fixtureRoute(provider, role === "warehouse lead" ? "none" : role);
  const mine = await run(usaDown);
  assert.equal(mine.error, undefined, "not 'on our side' when the choice removed the only listing");
  assert.equal(mine.summary?.removedByChoices, 1); assert.equal(mine.summary?.excludedBy.type, 1);
  assert.ok(mine.summary?.notices.some(n => /^USAJOBS did not answer/.test(n)), "the failed source is still named");
  const boardsDown: Route = provider => provider === "usajobs"
    ? { status: 200, body: { SearchResult: { SearchResultItems: [{ MatchedObjectId: "w-1", MatchedObjectDescriptor: { PositionTitle: "Warehouse Lead", OrganizationName: "Example Agency", PositionLocation: [{ CityName: "Milwaukee, Wisconsin", CountrySubDivisionCode: "Wisconsin" }], PositionSchedule: [{ Name: "Part-time" }], UserArea: { Details: { JobSummary: "Lead the warehouse." } } } }] } } }
    : { status: 503, body: {} };
  const full = await run(boardsDown);
  assert.equal(full.error, "provider_unavailable");
  assert.equal(full.summary?.removedByChoices, 1, "the page can say one loaded listing was removed by the person's choices");
});

test("R-S2: one broad family word never admits an office title; trade titles stay", () => {
  const plan = (q: string) => { const p = searchPlan(q, "", []); return (title: string) => jobRelevance({ title, full_description: "" }, p.roles, [], p.related, p.familyTitles).tier; };
  const warehouse = plan("warehouse lead");
  for (const t of ["Stock Plan Administrator", "Inventory Accountant", "Materials Engineer", "Distribution Sales Manager"]) assert.equal(warehouse(t), "none", t);
  assert.equal(plan("electrician")("Electrical Engineer"), "none");
  assert.equal(plan("machine operator")("Video Production Assistant"), "none");
  assert.equal(warehouse("Material Handler"), "title");
  assert.equal(warehouse("Dock Lead"), "title");
  for (const t of ["Shipping Associate", "Receiving Associate", "Fulfillment Center Associate", "Distribution Center Associate"]) assert.equal(warehouse(t), "title", t);
  assert.equal(plan("maintenance technician")("HVAC Tech"), "title");
  for (const t of ["Freight Order Coordinator", "Order Inventory Specialist"]) assert.equal(warehouse(t), "none", t);
  assert.equal(warehouse("Shipping and Receiving Dock Worker"), "title");
  assert.equal(warehouse("Forklift and Warehouse Crew"), "title", "two different family words together");
  assert.equal(plan("maintenance technician")("Millwright"), "title");
  assert.equal(plan("electrician")("Electrical Technician"), "title");
  assert.equal(plan("rigger")("Crane Rigging Technician"), "title");
});
