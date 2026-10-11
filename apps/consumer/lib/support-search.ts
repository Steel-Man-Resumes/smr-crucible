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
 * Every result says where it came from and when it was last checked. A HUD
 * counselor fetched live is labelled as HUD's list, not as checked by us.
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
import { parsePlace, stateName, type Place } from "./support-location";
import { foldName } from "./location-search";
import type { CounselorResult } from "./hud-counselors";

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
  const countyHit = !!place.countyKey && !!scope.counties?.includes(place.countyKey);
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

export type ResultSource = "curated" | "hud";

export interface SupportResult {
  id: string;
  source: ResultSource;
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
  /** The closest level any result reaches for this place. */
  level: ScopeLevel;
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

function coverageFor(place: Place, results: SupportResult[]): Coverage {
  const best = results.reduce<ScopeLevel>((acc, r) => (LEVEL_ORDER[r.scope] < LEVEL_ORDER[acc] ? r.scope : acc), "national");
  if (!place.given) {
    return { level: best, place: null, line: "Add your city and state to see help near you. These work anywhere." };
  }
  if (!place.state) {
    return {
      level: best,
      place: null,
      line: "We couldn't tell which state that is. Add it, like \"Libby, MT\", to see local help. These work anywhere.",
    };
  }
  const where = place.label ?? stateName(place.state) ?? place.state;
  if (best === "national") {
    return { level: best, place: where, line: `We don't have checked local listings for ${where} yet. These work anywhere.` };
  }
  if (best === "state" && (place.cityKey || place.countyKey || place.zip)) {
    return {
      level: best,
      place: where,
      line: `We don't have checked listings for ${where} itself yet. These cover ${stateName(place.state) ?? place.state} or work anywhere.`,
    };
  }
  return { level: best, place: where, line: null };
}

export interface SupportSearchDeps {
  findHud: (location: string) => Promise<CounselorResult[]>;
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

export async function searchSupport(input: SupportSearchInput, deps: SupportSearchDeps): Promise<SupportSearchResponse & { place: Place }> {
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const place = parsePlace(input.location);
  const cats = requestedCategories(input.category, input.barriers);
  const wanted = (c: string) => cats === "all" || (cats as string[]).includes(c);

  let results: SupportResult[] = RESOURCE_DIRECTORY
    .filter((r) => wanted(r.category) && scopeCovers(CURATED_SCOPES[r.geo], place))
    .map((r) => fromCurated(r, today));

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

  results.sort((a, b) => LEVEL_ORDER[a.scope] - LEVEL_ORDER[b.scope]);
  return { resources: results, coverage: coverageFor(place, results), place };
}

