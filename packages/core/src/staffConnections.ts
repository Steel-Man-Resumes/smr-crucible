/**
 * Connections the client missed (staff pass lane S5): employers with the
 * hiring mark, and places for job help, that fit what a person SHARED, each
 * with the reason it matched. For one person, or across the people a staff
 * member reaches.
 *
 * WHAT GOES IN, AND NOTHING ELSE
 *   - the job title, employer and place of the jobs they track, only while
 *     they share their applications with this organization;
 *   - the target of each resume, only while they share their resumes.
 * Both are read through orgClientView.getConnectionInputs, the door every
 * staff read uses: reach, the grant and its audience, "from today on", and
 * an access-log row the person sees, written in the same transaction.
 * NEVER used: their record (or anything from the record planner), their
 * address, their hurdle plan, their notes, anything not shared. Eligibility
 * is never inferred: a match says the employer hires for this kind of work
 * and what the directory knows, not that this person will be hired.
 *
 * NOT HERE (no sharing scope covers them; see the S5 report): a person's lane
 * focus and their home place, and the needs in their hurdle plan. Matching on
 * those needs a new scope the person agrees to, with its own words in
 * sharingScopes.ts. Until then they stay out.
 */
import type { OrgActor } from "./authz/resolveOrgActor";
import { getConnectionInputs, listConnectionCandidates, type ConnectionInputs } from "./orgClientView";
import { runScoped } from "./db";
import { searchVerifiedEmployers, searchVerifiedResources, type PublishedEmployer, type PublishedResource } from "./directoryPublication";
import {
  employerMatchReason, employerWhyForThem, firstNameOf, matchInputs, resourceMatchReason, resourceWhyForThem, sameCompany, MATCH_LIMITS_LINE, NOTHING_SHARED_LINE,
  type MatchPlace,
} from "./staffHandoffShared";

export interface EmployerMatch {
  kind: "employer"; id: string; name: string; band: "A" | "B"; bandReason: string; location: string | null; roleTypes: string | null;
  applyUrl: string | null; checkedAt: string | null; reason: string;
  /** The same reason in words for the person: the item's "why" if staff send it. */
  whyForThem: string;
  /** The role to put on their saved jobs if staff send it: the shared title it matched. */
  role: string;
}
export interface ResourceMatch {
  kind: "resource"; id: string; name: string; band: string; bandReason: string; area: string; place: string; checkedAt: string | null; reason: string;
  whyForThem: string;
}
export interface PersonConnections {
  clientId: string;
  name: string | null;
  firstName: string;
  status: "ok" | "nothing_shared" | "not_in_reach" | "directory_unavailable";
  shared: { applications: boolean; resume: boolean };
  employers: EmployerMatch[];
  resources: ResourceMatch[];
  /** Plain words: what matching used, or why there is nothing. */
  note: string;
}

export interface ConnectionDeps {
  inputs(actor: OrgActor, ids: readonly string[], opts?: { via?: "t.ROY" }): ReturnType<typeof getConnectionInputs>;
  candidates(actor: OrgActor): ReturnType<typeof listConnectionCandidates>;
  employers(q: { q: string; state?: string }): Promise<{ status: string; data: PublishedEmployer[] }>;
  resources(q: { state: string; cityKey: string | null }): Promise<{ status: string; data: PublishedResource[] }>;
  /** What was already sent to each person (any answer): never offered again. */
  known(actor: OrgActor, ids: readonly string[]): Promise<KnownItems>;
}
export type KnownItems = Map<string, { employers: Set<string>; resources: Set<string>; companies: string[] }>;

/** Folded city key, the same fold the resource directory matches on (lib/location-search foldName). */
export function foldCity(s: string | null | undefined): string | null {
  const t = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\bsaint\b/g, "st").replace(/\bfort\b/g, "ft").replace(/\bmount\b/g, "mt").replace(/\s+/g, " ");
  return t && t.length <= 80 ? t : null;
}

/** $1 org, $2 sees-all, $3 actor, $4 people. Everything already sent to these people, reach-checked. */
export const KNOWN_ITEMS_SQL = `SELECT s.client_user_id AS id, s.employer_ref, s.resource_ref, s.company
    FROM staff_suggestion s
   WHERE s.access_code_id = $1::uuid AND s.client_user_id = ANY($4::uuid[])
     AND s.kind IN ('job', 'employer', 'resource')
     AND ($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
                                  WHERE a.access_code_id = $1::uuid AND a.client_user_id = s.client_user_id AND a.staff_user_id = $3::uuid)
          OR public.smr_staff_reach($1::uuid, $3::uuid, s.client_user_id))`;

async function knownItems(actor: OrgActor, ids: readonly string[]): Promise<KnownItems> {
  const out: KnownItems = new Map();
  if (ids.length === 0) return out;
  // Before 110 the ref columns do not exist; read them through to_jsonb so this never breaks a page.
  const sql = KNOWN_ITEMS_SQL.replace("s.employer_ref, s.resource_ref", "to_jsonb(s)->>'employer_ref' AS employer_ref, to_jsonb(s)->>'resource_ref' AS resource_ref");
  const [rows] = await runScoped<[{ id: string; employer_ref: string | null; resource_ref: string | null; company: string | null }[]]>(
    { orgId: actor.orgId, userId: actor.userId, role: actor.role },
    (c) => [(c as unknown as (s: string, p: unknown[]) => unknown)(sql, [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, [...ids]])],
  );
  for (const r of rows) {
    const k = out.get(r.id) ?? { employers: new Set<string>(), resources: new Set<string>(), companies: [] };
    if (r.employer_ref) k.employers.add(r.employer_ref.toLowerCase());
    if (r.resource_ref) k.resources.add(r.resource_ref.toLowerCase());
    if (r.company) k.companies.push(r.company);
    out.set(r.id, k);
  }
  return out;
}

export const liveConnectionDeps: ConnectionDeps = {
  inputs: getConnectionInputs,
  candidates: (a) => listConnectionCandidates(a),
  employers: ({ q, state }) => searchVerifiedEmployers({ q, state, bands: ["A", "B"], limit: 10 }),
  resources: ({ state, cityKey }) => searchVerifiedResources({ state, areas: ["jobs", "training"], cityKey, bands: ["A", "B"], pageSize: 10 }),
  known: knownItems,
};

const CAPS = { employers: 5, resources: 3 } as const;

/** Directory questions shared across one call (the caseload asks the same ones for many people). */
function searchCache(deps: ConnectionDeps) {
  const e = new Map<string, ReturnType<ConnectionDeps["employers"]>>();
  const r = new Map<string, ReturnType<ConnectionDeps["resources"]>>();
  return {
    employers(q: string, state?: string) { const k = `${q}|${state ?? ""}`; if (!e.has(k)) e.set(k, deps.employers({ q, state })); return e.get(k)!; },
    resources(place: MatchPlace) { const ck = foldCity(place.city); const k = `${place.state}|${ck ?? ""}`; if (!r.has(k)) r.set(k, deps.resources({ state: place.state, cityKey: ck })); return r.get(k)!; },
  };
}

/** Pure given the reads: the matches for one person, best first, each with its reason. */
export async function matchPerson(
  input: ConnectionInputs, name: string | null, known: KnownItems, cache: ReturnType<typeof searchCache>,
): Promise<PersonConnections> {
  const base = {
    clientId: input.clientId, name, firstName: firstNameOf(name, "this person"),
    shared: { applications: input.applicationsShared, resume: input.resumeShared },
    employers: [] as EmployerMatch[], resources: [] as ResourceMatch[],
  };
  if (!input.inReach) return { ...base, status: "not_in_reach", note: "That person is not on your list." };
  if (!input.applicationsShared && !input.resumeShared) return { ...base, status: "nothing_shared", note: NOTHING_SHARED_LINE };
  const mi = matchInputs({ applications: input.applicationsShared ? input.applications : [], resumeTargets: input.resumeShared ? input.resumeTargets : [] });
  const k = known.get(input.clientId) ?? { employers: new Set<string>(), resources: new Set<string>(), companies: [] };
  const theirCompanies = input.applications.map((a) => a.company).filter((c): c is string => !!c);
  let unavailable = false;

  const employers: EmployerMatch[] = [];
  const places: (MatchPlace | null)[] = mi.places.length ? mi.places : [null];
  for (const term of mi.terms) {
    for (const place of places) {
      if (employers.length >= CAPS.employers * 2) break;
      const res = await cache.employers(term.term, place?.state);
      if (res.status !== "ok") { unavailable = true; continue; }
      for (const e of res.data) {
        if (employers.some((x) => x.id === e.id) || k.employers.has(e.id.toLowerCase())) continue;
        if (theirCompanies.some((c) => sameCompany(c, e.name)) || k.companies.some((c) => sameCompany(c, e.name))) continue;
        employers.push({
          kind: "employer", id: e.id, name: e.name, band: e.band, bandReason: e.band_reason, location: e.location ?? ([e.city, e.state].filter(Boolean).join(", ") || null),
          roleTypes: e.roleTypes, applyUrl: e.applyUrl, checkedAt: e.checkedAt ?? null,
          reason: employerMatchReason({ band: e.band, checkedAt: e.checkedAt, state: e.state }, term, place),
          whyForThem: employerWhyForThem({ band: e.band, state: e.state }, term, place),
          role: term.from,
        });
      }
    }
  }
  // The mark first, then the directory's own order.
  employers.sort((x, y) => (x.band === y.band ? 0 : x.band === "A" ? -1 : 1));

  const resources: ResourceMatch[] = [];
  for (const place of mi.places) {
    const res = await cache.resources(place);
    if (res.status !== "ok") { unavailable = true; continue; }
    for (const r of res.data) {
      if (resources.length >= CAPS.resources) break;
      if (resources.some((x) => x.id === r.service_id) || k.resources.has(r.service_id.toLowerCase())) continue;
      resources.push({
        kind: "resource", id: r.service_id, name: r.service_name ? `${r.service_name}, ${r.org_name}` : r.org_name, band: r.band, bandReason: r.band_reason,
        area: r.area_label, place: place.label, checkedAt: r.last_checked ?? null, reason: resourceMatchReason(r, place), whyForThem: resourceWhyForThem(r, place),
      });
    }
  }

  const found = employers.length + resources.length;
  const used = [input.applicationsShared ? "the jobs they shared" : null, input.resumeShared ? "the resumes they shared" : null].filter(Boolean).join(" and ");
  const note = unavailable && found === 0
    ? "The directory could not be read just now. Try again in a minute."
    : found === 0
      ? `Nothing new matched ${used}${mi.places.length ? "" : " (no place in the jobs they shared, so local help could not be matched)"}. ${MATCH_LIMITS_LINE}`
      : `Matched on ${used}. ${MATCH_LIMITS_LINE}`;
  return {
    ...base,
    status: unavailable && found === 0 ? "directory_unavailable" : "ok",
    employers: employers.slice(0, CAPS.employers),
    resources,
    note,
  };
}

/** One person: reach, consent and the log are all in getConnectionInputs. null = no access. */
export async function getConnectionsFor(actor: OrgActor, clientId: string, name: string | null = null, deps: ConnectionDeps = liveConnectionDeps, opts: { via?: "t.ROY" } = {}): Promise<PersonConnections | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const read = await deps.inputs(actor, [clientId], opts);
  if (!read.ok) return null;
  const input = read.rows[0];
  if (!input) return null;
  const known = input.inReach ? await deps.known(actor, [input.clientId]) : new Map();
  return matchPerson(input, name, known, searchCache(deps));
}

export interface CaseloadConnections {
  people: PersonConnections[];
  /** People on the list who share nothing to match on (named, so staff can ask). */
  notSharing: number;
  note: string;
}

/**
 * Across the people this staff member reaches who share applications or
 * resumes (at most 25, newest sharing first). Only people with a match are
 * returned. Every person whose shared material was read gets a log line.
 */
export async function getCaseloadConnections(actor: OrgActor, deps: ConnectionDeps = liveConnectionDeps): Promise<CaseloadConnections | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.client.view_content")) return null;
  const cand = await deps.candidates(actor);
  if (!cand.ok) return null;
  if (cand.rows.length === 0) return { people: [], notSharing: 0, note: "Nobody you work with shares their job applications or resumes yet, so there is nothing to match on." };
  const names = new Map(cand.rows.map((r) => [r.id, r.name]));
  const read = await deps.inputs(actor, cand.rows.map((r) => r.id));
  if (!read.ok) return null;
  const reached = read.rows.filter((r) => r.inReach);
  const known = await deps.known(actor, reached.map((r) => r.clientId));
  const cache = searchCache(deps);
  const people: PersonConnections[] = [];
  let notSharing = 0;
  for (const input of reached) {
    const p = await matchPerson(input, names.get(input.clientId) ?? null, known, cache);
    if (p.status === "nothing_shared") notSharing++;
    else if (p.employers.length + p.resources.length > 0) people.push(p);
  }
  return {
    people,
    notSharing,
    note: `${MATCH_LIMITS_LINE} Looking here is recorded for each person whose shared jobs or resumes were read, and they can see it.`,
  };
}
