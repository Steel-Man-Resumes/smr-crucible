/**
 * Support search: local help that is honest about where it reaches
 * (Phase 5 lane R3, Codex A4).
 *
 * Every service has a real scope: anywhere in the US, one state, one county
 * (or a few), or one city. A service shows only when its scope covers the
 * place the person gave. When we have nothing checked for that place, the
 * person sees the services that work anywhere and a plain line saying so.
 * Nobody in New York is handed a Wisconsin shelter.
 *
 * Sources, in order: the checked resource directory (migration 082,
 * resource_app_v: approved, fresh, active services only); the earlier
 * hand-checked list, only where the directory has nothing as close to the
 * person; and HUD's counselor list for housing. Every result says which one
 * it came from and when it was last checked. A HUD counselor fetched live is
 * labelled as HUD's list, not as checked by us.
 *
 * Pure apart from the injected lookups, so the route is tested end to end
 * with fake HUD answers and no network.
 */

import {
  BARRIER_CATEGORY_MAP,
  RESOURCE_DIRECTORY,
  type ResourceCategory,
  type ResourceEntry,
} from "./resource-directory";
import { countyKeyOf, parsePlace, stateName, type Place } from "./support-location";
import { foldName } from "./location-search";
import type { CounselorResult } from "./hud-counselors";
import {
  RESOURCE_AREAS,
  isResourceArea,
  type ResourceArea,
  type ResourceAppRow,
  type ResourcePlaceQuery,
} from "@crucible/core/src/resourceDirectoryShared";

// ─── Scope ──────────────────────────────────────────────────────────────────

export type ScopeLevel = "city" | "county" | "state" | "national";

export interface ServiceScope {
  level: ScopeLevel;
  state: string | null;
  /** Folded county names (county level). */
  counties?: string[];
  /** Folded city names: the city itself (city level), or cities known to sit in the county. */
  cities?: string[];
  /** ZIP codes inside the area, when known. */
  zips?: string[];
  /** What the person reads: "Libby, MT", "Lincoln County, MT", "Montana", "Anywhere in the US". */
  label: string;
}

/** Does this service's scope reach the person's place? No state given means only national services do. */
export function scopeCovers(scope: ServiceScope, place: Place): boolean {
  if (scope.level === "national") return true;
  if (!place.state || scope.state !== place.state) return false;
  if (scope.level === "state") return true;
  const zipHit = !!place.zip && !!scope.zips?.includes(place.zip);
  const cityHit = !!place.cityKey && !!scope.cities?.includes(place.cityKey);
  if (scope.level === "city") return cityHit || zipHit;
  const countyHit = place.countyKeys.some((k) => !!scope.counties?.includes(k));
  return countyHit || cityHit || zipHit;
}

const LEVEL_ORDER: Record<ScopeLevel, number> = { city: 0, county: 1, state: 2, national: 3 };

// ─── The earlier hand-checked list (lib/resource-directory.ts) ──────────────

/**
 * The real reach of each label in the earlier list. "milwaukee" entries are
 * Milwaukee County services; the two Montana entries are offices in Libby
 * serving Lincoln County. The city lists are the county's own incorporated
 * cities and villages, so "Wauwatosa, WI" still finds Milwaukee County help.
 */
const CURATED_SCOPES: Record<ResourceEntry["geo"], ServiceScope> = {
  milwaukee: {
    level: "county", state: "WI", counties: ["milwaukee"],
    cities: ["milwaukee", "wauwatosa", "west allis", "greenfield", "oak creek", "franklin", "south milwaukee",
      "cudahy", "glendale", "st francis", "greendale", "hales corners", "shorewood", "whitefish bay",
      "fox point", "brown deer", "river hills", "bayside", "west milwaukee"],
    label: "Milwaukee County, WI",
  },
  waukesha: {
    level: "county", state: "WI", counties: ["waukesha"],
    cities: ["waukesha", "brookfield", "new berlin", "muskego", "oconomowoc", "pewaukee", "delafield",
      "menomonee falls", "mukwonago", "hartland", "sussex", "elm grove", "butler", "big bend", "dousman",
      "lannon", "merton", "north prairie", "wales", "chenequa", "eagle", "lac la belle", "nashotah",
      "oconomowoc lake", "summit"],
    label: "Waukesha County, WI",
  },
  wisconsin: { level: "state", state: "WI", label: "Wisconsin" },
  montana: {
    level: "county", state: "MT", counties: ["lincoln"],
    cities: ["libby", "troy", "eureka", "rexford"],
    zips: ["59923", "59935", "59917", "59930"],
    label: "Lincoln County, MT",
  },
  national: { level: "national", state: null, label: "Anywhere in the US" },
};

// ─── Categories ─────────────────────────────────────────────────────────────

export const CURATED_CATEGORIES: readonly ResourceCategory[] = [
  "housing", "transportation", "legal", "id_documents", "mental_health", "substance", "education", "financial", "employment",
];

function isCuratedCategory(s: unknown): s is ResourceCategory {
  return typeof s === "string" && (CURATED_CATEGORIES as readonly string[]).includes(s);
}

/** The directory areas (072 resource_area) behind each category of the earlier list. */
export const CATEGORY_AREAS: Record<ResourceCategory, ResourceArea[]> = {
  housing: ["shelter"],
  transportation: ["transportation"],
  legal: ["legal_aid", "expungement", "courts"],
  id_documents: ["id_documents"],
  mental_health: ["mental"],
  substance: ["recovery"],
  education: ["education", "training"],
  financial: ["financial"],
  employment: ["jobs", "training"],
};

/** The earlier-list categories an area answers (training answers two). */
export function categoriesOfArea(area: string): ResourceCategory[] {
  return CURATED_CATEGORIES.filter((c) => (CATEGORY_AREAS[c] as string[]).includes(area));
}

export interface Wanted {
  categories: ResourceCategory[];
  areas: ResourceArea[];
}

/**
 * What a request asks about: categories of the earlier list (or barriers that
 * map to them), or a directory area by its own name ("food"). Unknown words
 * are dropped, never guessed; nothing asked for means everything.
 */
export function requestedWants(category: unknown, barriers: unknown): Wanted {
  const cats = requestedCategories(category, barriers);
  if (cats === "all") return { categories: [...CURATED_CATEGORIES], areas: [...RESOURCE_AREAS] };
  const areas = new Set<ResourceArea>();
  for (const c of cats) CATEGORY_AREAS[c].forEach((a) => areas.add(a));
  if (!cats.length && isResourceArea(category)) areas.add(category);
  return { categories: cats, areas: [...areas] };
}

/** Which categories a request asks about. Unknown words are dropped, never guessed. */
export function requestedCategories(category: unknown, barriers: unknown): ResourceCategory[] | "all" {
  if (isCuratedCategory(category)) return [category];
  if (Array.isArray(barriers) && barriers.length) {
    const out = new Set<ResourceCategory>();
    for (const b of barriers.slice(0, 20)) {
      const cats = typeof b === "string" && Object.prototype.hasOwnProperty.call(BARRIER_CATEGORY_MAP, b) ? BARRIER_CATEGORY_MAP[b] : null;
      cats?.forEach((c) => out.add(c));
    }
    return [...out];
  }
  if (category == null || category === "") return "all";
  return [];
}

// ─── Results ────────────────────────────────────────────────────────────────

export type ResultSource = "directory" | "curated" | "hud";

export interface SupportResult {
  id: string;
  source: ResultSource;
  /** Directory rows only: A checked, B listed, C found. Missing for the earlier list and HUD. */
  band?: SupportBand;
  /** Plain words for where this came from. */
  sourceLabel: string;
  category: string;
  type: ResourceEntry["type"];
  title: string;
  provider: string;
  description: string;
  phone?: string;
  textNumber?: string;
  address?: string;
  hours?: string;
  eligibility?: string;
  fees?: string;
  whatToBring?: string;
  limits?: string;
  website?: string;
  apiEndpoint?: string;
  tags: string[];
  scope: ScopeLevel;
  state: string | null;
  /** Where it reaches, in words. */
  area: string;
  /** YYYY-MM-DD of our last check, or null when we have not checked it ourselves (HUD). */
  lastChecked: string | null;
  /** The line the page shows under the result. */
  checkedLine: string;
  sourceUrl: string | null;
  /** Checked more than STALE_DAYS ago: the line asks the person to call first. */
  mayBeOutOfDate: boolean;
}

export interface Coverage {
  /** The closest level any checked result reaches for this place. */
  level: ScopeLevel;
  /**
   * How precisely we could place the person: a county, a city we could not
   * put in a county, only a state, or nowhere. "state" for a ZIP we could not
   * match to a county, so the line never claims there is nothing local.
   */
  placeMatched: "county" | "city" | "state" | "none";
  place: string | null;
  /** Shown above the list when local coverage is missing; null when there is local help. */
  line: string | null;
}

export interface SupportSearchResponse {
  resources: SupportResult[];
  coverage: Coverage;
}

export const STALE_DAYS = 180;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function showDate(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

function daysBetween(fromYmd: string, today: string): number {
  const a = Date.parse(`${fromYmd.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.floor((b - a) / 86_400_000) : Infinity;
}

function checkedLineFor(lastChecked: string, today: string): { line: string; stale: boolean } {
  const stale = daysBetween(lastChecked, today) > STALE_DAYS;
  return {
    line: stale
      ? `Last checked ${showDate(lastChecked)}. That was a while ago, so call first to make sure it still runs.`
      : `Last checked ${showDate(lastChecked)}.`,
    stale,
  };
}

function fromCurated(r: ResourceEntry, today: string): SupportResult {
  const scope = CURATED_SCOPES[r.geo];
  const { line, stale } = checkedLineFor(r.verifiedAt, today);
  return {
    id: r.id,
    source: "curated",
    sourceLabel: "Our earlier hand-checked list",
    category: r.category,
    type: r.type,
    title: r.title,
    provider: r.provider,
    description: r.description,
    phone: r.phone,
    textNumber: r.textNumber,
    address: r.address,
    hours: r.hours,
    eligibility: r.eligibility,
    apiEndpoint: r.apiEndpoint,
    tags: r.tags,
    scope: scope.level,
    state: scope.state,
    area: scope.label,
    lastChecked: r.verifiedAt,
    checkedLine: line,
    sourceUrl: null,
    mayBeOutOfDate: stale,
  };
}

const SCOPE_LEVEL: Record<ResourceAppRow["geo_scope"], ScopeLevel> = {
  city: "city", county: "county", multi_county: "county", statewide: "state", national: "national",
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const countyWord = (s: string) => (/\s(county|parish|borough)$/i.test(s) ? s : `${s} County`);

/** A directory row's real reach, from its geo_scope and place fields. */
export function directoryScope(r: ResourceAppRow): ServiceScope {
  const level = SCOPE_LEVEL[r.geo_scope] ?? "national";
  const st = /^[A-Z]{2}$/.test(r.state) ? r.state : null;
  if (level === "national") return { level, state: null, label: "Anywhere in the US" };
  if (level === "state") return { level, state: st, label: stateName(st) ?? st ?? "One state" };
  const zips = r.zip && /^\d{5}$/.test(r.zip.slice(0, 5)) ? [r.zip.slice(0, 5)] : [];
  if (level === "city") {
    return { level, state: st, cities: r.city ? [foldName(r.city)] : [], zips, label: [r.city ? titleCase(r.city) : null, st].filter(Boolean).join(", ") };
  }
  const named = [...(r.counties ?? []), ...(r.county ? [r.county] : [])].filter((c) => typeof c === "string" && c.trim());
  const counties = [...new Set(named.map(countyKeyOf))];
  const label = named.length === 1
    ? `${titleCase(countyWord(named[0]))}, ${st}`
    : named.length > 1
      ? `${named.slice(0, -1).map((c) => titleCase(c.replace(/\s+county$/i, ""))).join(", ")} and ${titleCase(named[named.length - 1].replace(/\s+county$/i, ""))} counties, ${st}`
      : `${stateName(st) ?? st}, some counties`;
  return { level, state: st, counties, cities: r.city ? [foldName(r.city)] : [], zips, label };
}

/** Older directory rows remain valid; published rows add practical visit details. */
export interface SupportDirectoryRow extends ResourceAppRow {
  fees?: string | null;
  what_to_bring?: string | null;
  limits?: string | null;
  /** Publication band (migration 089): A checked, B listed, C found. Missing means A (an older read). */
  band?: SupportBand;
  band_reason?: string | null;
}

export type SupportBand = "A" | "B" | "C";
export const BAND_ORDER: Record<SupportBand, number> = { A: 0, B: 1, C: 2 };
/** Troy 2026-10-18: show what we have collected, best first; the unchecked rows carry their own label so nobody reads them as canon. */
export const BAND_SOURCE_LABEL: Record<SupportBand, string> = {
  A: "Steel Man's checked directory",
  B: "Listed, not yet checked by us",
  C: "Found, could not confirm. Call first.",
};
export function bandOf(r: SupportDirectoryRow): SupportBand {
  return r.band === "B" || r.band === "C" ? r.band : "A";
}

export function fromDirectory(r: SupportDirectoryRow): SupportResult {
  const scope = directoryScope(r);
  const cats = categoriesOfArea(r.area_id);
  const lastChecked = String(r.last_checked).slice(0, 10);
  const stZip = [r.state, r.zip].filter(Boolean).join(" ");
  const band = bandOf(r);
  const reason = typeof r.band_reason === "string" && r.band_reason.trim() ? r.band_reason.trim() : null;
  return {
    id: `dir-${r.service_id}`,
    source: "directory",
    band,
    sourceLabel: BAND_SOURCE_LABEL[band],
    category: cats[0] ?? r.area_id,
    type: "curated",
    title: r.service_name?.trim() || r.org_name,
    provider: r.org_name,
    description: r.description,
    phone: r.phone || undefined,
    address: r.address ? [r.address, r.city, stZip].filter(Boolean).join(", ") : undefined,
    hours: r.hours || undefined,
    eligibility: r.eligibility || undefined,
    fees: r.fees?.trim() || undefined,
    whatToBring: r.what_to_bring?.trim() || undefined,
    limits: r.limits?.trim() || undefined,
    website: r.website && /^https?:\/\//i.test(r.website) ? r.website : undefined,
    tags: [r.area_id],
    scope: scope.level,
    state: scope.state,
    area: scope.label,
    lastChecked,
    checkedLine: band === "A"
      ? `Last checked ${showDate(lastChecked)}.`
      : `${reason ?? BAND_SOURCE_LABEL[band]} Last looked at ${showDate(lastChecked)}. Call first.`,
    sourceUrl: /^https?:\/\//i.test(r.source_url) ? r.source_url : null,
    mayBeOutOfDate: band === "C",
  };
}

/** A HUD counselor keeps the address and state HUD gave. */
export function fromHud(c: CounselorResult): SupportResult {
  const state = /^[A-Z]{2}$/.test(c.state) ? c.state : null;
  return {
    id: `hud-${foldName(`${c.name} ${c.city} ${c.state}`).replace(/\s+/g, "-").slice(0, 60)}`,
    source: "hud",
    sourceLabel: "HUD's list of approved housing counselors",
    category: "housing",
    type: "curated",
    title: c.name,
    provider: "HUD-approved housing counseling agency",
    description: c.services?.length
      ? `Services: ${c.services.slice(0, 3).join(", ")}`
      : "HUD-approved housing counseling agency. Free counseling for renters and homebuyers.",
    phone: c.phone || undefined,
    address: [c.address, c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined,
    website: c.website || undefined,
    tags: ["housing", "counseling", "hud"],
    scope: "city",
    state,
    area: [c.city, state].filter(Boolean).join(", ") || "Near you",
    lastChecked: null,
    checkedLine: "From HUD's live list. We have not checked this one ourselves, so call first.",
    sourceUrl: null,
    mayBeOutOfDate: false,
  };
}

/**
 * How close our CHECKED listings come. HUD's live list is not our check, so it
 * never makes a place count as covered; when it is there the line says so.
 */
function coverageFor(place: Place, all: SupportResult[]): Coverage {
  // Checked means band A or the earlier hand-checked list; a listed or found row never makes a place count as covered.
  const results = all.filter((r) => r.source !== "hud" && (r.source !== "directory" || (r.band ?? "A") === "A"));
  const hudNote = all.some((r) => r.source === "hud") ? " HUD's counselors near you are listed too." : "";
  const best = results.reduce<ScopeLevel>((acc, r) => (LEVEL_ORDER[r.scope] < LEVEL_ORDER[acc] ? r.scope : acc), "national");
  const placeMatched: Coverage["placeMatched"] = !place.state ? "none"
    : place.countyKeys.length ? "county"
    : place.cityKey ? "city"
    : "state";
  if (!place.given) {
    return { level: best, placeMatched, place: null, line: "Add your city and state to see help near you. These work anywhere." };
  }
  if (!place.state) {
    return {
      level: best,
      placeMatched,
      place: null,
      line: "We couldn't tell which state that is. Add it, like \"Libby, MT\", to see local help. These work anywhere.",
    };
  }
  const where = place.label ?? stateName(place.state) ?? place.state;
  const stName = stateName(place.state) ?? place.state;
  // A ZIP we could not put in a county: we only know the state, so say that,
  // never "nothing local" (review L2).
  if (placeMatched === "state" && place.zip && (best === "national" || best === "state")) {
    return {
      level: best,
      placeMatched,
      place: where,
      line: `We couldn't match ZIP ${place.zip} to a county, so these cover ${stName} or work anywhere. Add your town to see local help.${hudNote}`,
    };
  }
  if (best === "national") {
    return { level: best, placeMatched, place: where, line: `We don't have checked local listings for ${where} yet. These work anywhere.${hudNote}` };
  }
  if (best === "state" && (place.cityKey || place.countyKey || place.zip)) {
    return {
      level: best,
      placeMatched,
      place: where,
      line: `We don't have checked listings for ${where} itself yet. These cover ${stName} or work anywhere.${hudNote}`,
    };
  }
  return { level: best, placeMatched, place: where, line: null };
}

export interface SupportSearchDeps {
  findHud: (location: string) => Promise<CounselorResult[]>;
  /** Publication rows that reach the place, closest first (core searchVerifiedResources); bands asks for the listed and found layers too. */
  readDirectory?: (opts: ResourcePlaceQuery & { bands?: readonly SupportBand[] }) => Promise<SupportDirectoryRow[]>;
  /** The counties a city or ZIP sits in, folded (lib/support-place-index.ts). */
  countiesOf?: (place: Place) => string[];
  /** Is a folded name a Census place in a state (lib/support-place-index.ts)? Lets "libby mt" read as Montana. */
  isPlaceIn?: (cityKey: string, state: string) => boolean;
  /** YYYY-MM-DD, injectable for tests. */
  today?: string;
}

export interface SupportSearchInput {
  category?: unknown;
  barriers?: unknown;
  location?: unknown;
}

/** What HUD is asked for: the normalised place only, never the raw text. */
export function hudQueryFor(place: Place): string | null {
  if (!place.state) return null;
  if (place.zip) return place.zip;
  if (place.label && (place.cityKey || place.countyKey)) return place.label;
  return null;
}

export interface SupportSearchResult extends SupportSearchResponse {
  place: Place;
  /** false when the directory could not be read (missing view, outage): the earlier list stood in. */
  directoryRead: boolean;
}

export async function searchSupport(input: SupportSearchInput, deps: SupportSearchDeps): Promise<SupportSearchResult> {
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const parsed = parsePlace(input.location, { isPlaceIn: deps.isPlaceIn });
  let place = parsed;
  if (deps.countiesOf && parsed.state && !parsed.countyKey && (parsed.cityKey || parsed.zip)) {
    try {
      const found = deps.countiesOf(parsed).filter((k) => typeof k === "string" && k);
      if (found.length) place = { ...parsed, countyKeys: [...new Set([...parsed.countyKeys, ...found])] };
    } catch {
      // No county lookup: city and ZIP matching still work.
    }
  }
  const cats = requestedCategories(input.category, input.barriers);
  const want = requestedWants(input.category, input.barriers);
  const wanted = (c: string) => cats === "all" || (cats as string[]).includes(c);

  // 1. The checked directory first.
  let dirRows: SupportDirectoryRow[] = [];
  let directoryRead = !deps.readDirectory;
  if (deps.readDirectory && want.areas.length) {
    try {
      const rows = await deps.readDirectory({
        state: place.state, areas: want.areas, countyKeys: place.countyKeys, cityKey: place.cityKey, zip: place.zip, bands: ["A", "B", "C"],
      });
      dirRows = rows.filter((r) => want.areas.includes(r.area_id as ResourceArea) && scopeCovers(directoryScope(r), place));
      directoryRead = true;
    } catch {
      directoryRead = false;
    }
  } else if (deps.readDirectory) {
    directoryRead = true;
  }

  // 2. The earlier list, only where the directory has nothing as close to the
  // person for that kind of help (the category's main area: shelter for
  // housing, jobs for employment): a directory county listing replaces earlier
  // county, state and national ones; a directory national listing replaces
  // only earlier national ones. A side area (training, expungement) adds to
  // the earlier list rather than replacing it.
  const directory = dirRows.map(fromDirectory);
  // Only a CHECKED directory row (band A) stands in for the earlier hand-checked list.
  const closest = new Map<ResourceCategory, number>();
  for (const r of dirRows.filter((row) => bandOf(row) === "A")) {
    for (const c of CURATED_CATEGORIES) {
      if (CATEGORY_AREAS[c][0] !== r.area_id) continue;
      const lvl = LEVEL_ORDER[directoryScope(r).level];
      if (!closest.has(c) || lvl < (closest.get(c) as number)) closest.set(c, lvl);
    }
  }
  const curated = RESOURCE_DIRECTORY
    .filter((r) => wanted(r.category) && scopeCovers(CURATED_SCOPES[r.geo], place))
    .filter((r) => {
      const dirBest = closest.get(r.category);
      return dirBest === undefined || LEVEL_ORDER[CURATED_SCOPES[r.geo].level] < dirBest;
    })
    .map((r) => fromCurated(r, today));

  let results: SupportResult[] = [...directory, ...curated];

  // HUD's counselor search is by distance from a real place. Asked only when
  // the place has a state, and only counselors in that state are kept: the
  // person asked about their state, and we do not send them across a line.
  if (wanted("housing") && cats !== "all") {
    const q = hudQueryFor(place);
    if (q) {
      try {
        const counselors = await deps.findHud(q);
        results = results.concat(counselors.filter((c) => c.state === place.state).map((c) => fromHud(c)));
      } catch {
        // HUD is down: the checked list still stands.
      }
    }
  }

  const SOURCE_ORDER: Record<ResultSource, number> = { directory: 0, hud: 1, curated: 2 };
  // Closest first; within a level the checked band, then HUD and the earlier list, then listed, then found.
  const rank = (r: SupportResult) => (r.source === "directory" ? BAND_ORDER[r.band ?? "A"] * 10 : 5) + SOURCE_ORDER[r.source];
  results.sort((a, b) => LEVEL_ORDER[a.scope] - LEVEL_ORDER[b.scope] || rank(a) - rank(b));
  return { resources: results, coverage: coverageFor(place, results), place, directoryRead };
}

