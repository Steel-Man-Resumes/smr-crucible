/**
 * The staff Directory (lane S1, staff pass 2026-10-27): one search across
 * local help and employers that hire people with records.
 *
 * PUBLIC DIRECTORY DATA ONLY. The staff member types the place, the kind of
 * help and the kind of work; nothing about any participant is read, sent or
 * shown. The same readers and the same words as the public site and staff
 * t.ROY: resources from searchVerifiedResources, checked (A) before listed
 * (B) before found (C); employers from searchVerifiedEmployers, the mark (A)
 * before reported (B), each with the date its evidence was checked and the
 * date it needs a recheck.
 *
 * Pure: the route (app/api/org/directory) reads, this file shapes, and the
 * tests check the shaping without a database.
 */
import { RESOURCE_AREAS, type ResourceArea } from "@crucible/core/src/resourceDirectoryShared";
import { resourceEvidenceLabel, employerEvidenceLabel } from "./directory-labels";

/** Plain words for each kind of help (the filter and the result line). */
export const AREA_WORDS: Readonly<Record<ResourceArea, string>> = {
  shelter: "A place to stay", food: "Food", clothing: "Clothing", safety: "Safety", physical: "Health care",
  mental: "Mental health", recovery: "Recovery", id_documents: "ID and documents", legal_aid: "Legal help",
  expungement: "Clearing a record", courts: "Court help", jobs: "Job help", training: "Training",
  education: "School and GED", financial: "Money help", community: "Community help", faith: "Faith groups",
  veterans: "Veterans", youth: "Young adults", transportation: "Rides and transit",
};

export type DirectoryShow = "all" | "help" | "employers";

export interface DirectoryQuery {
  /** The place as typed: "Detroit, MI", "Lincoln County, MT", "48201". */
  place: string;
  /** Kinds of help, at most 3. Empty means every kind. */
  needs: ResourceArea[];
  /** Employer name or kind of work. */
  q: string | null;
  /** Employer industry, exactly as the directory lists it. */
  sector: string | null;
  show: DirectoryShow;
}

const clip = (v: string | null, n: number) => {
  const s = (v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  return s || null;
};

/** Read ?place= ?need= (repeatable or comma list) ?q= ?sector= ?show=. Anything else is ignored. */
export function parseDirectoryQuery(params: URLSearchParams): DirectoryQuery {
  const needs = params.getAll("need").flatMap((v) => v.split(",")).map((v) => v.trim())
    .filter((v): v is ResourceArea => (RESOURCE_AREAS as readonly string[]).includes(v));
  const show = params.get("show");
  const sector = clip(params.get("sector"), 80);
  return {
    place: clip(params.get("place"), 120) ?? "",
    needs: [...new Set(needs)].slice(0, 3),
    q: clip(params.get("q"), 80),
    sector: sector && sector.toLowerCase() !== "all" ? sector : null,
    show: show === "help" || show === "employers" ? show : "all",
  };
}

/** How many of each a search shows. No paging and no export: search narrower for more. */
export const DIRECTORY_MAX_EACH = 20;

export interface DirectoryResource {
  kind: "resource";
  id: string;
  name: string;
  organization: string;
  service: string | null;
  need: string;
  band: "A" | "B" | "C";
  /** The public site's words for the band. */
  howSure: string;
  howSureDetail: string;
  lastChecked: string | null;
  phone: string | null;
  hours: string | null;
  website: string | null;
  where: string | null;
  eligibility: string | null;
  source: string | null;
}

export interface DirectoryEmployer {
  kind: "employer";
  id: string;
  name: string;
  industry: string | null;
  where: string | null;
  band: "A" | "B";
  /** "Hires people with records" (the mark) or "Reported hiring evidence". */
  howSure: string;
  /** The date the evidence was checked. */
  evidenceOn: string | null;
  /** When it needs a recheck; past this date we do not show it at all. */
  recheckBy: string | null;
  roles: string | null;
  evidence: string | null;
  caveats: string | null;
  apply: string | null;
  source: string | null;
}

type ResourceRowLike = {
  service_id: string; org_name: string; service_name: string | null; area_id?: string; area_label?: string; band?: string | null; band_reason?: string | null;
  last_checked?: string | null; phone?: string | null; hours?: string | null; website?: string | null; city?: string | null; county?: string | null;
  state?: string | null; eligibility?: string | null; source_url?: string | null; geo_scope?: string | null;
};
type EmployerRowLike = {
  id: string; name: string; industry?: string | null; city?: string | null; state?: string | null; location?: string | null; band?: string | null;
  checkedAt?: string | null; expiresAt?: string | null; roleTypes?: string | null; evidence?: string | null; caveats?: string | null;
  applyUrl?: string | null; sourceUrl?: string | null;
};

const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v.slice(0, 500) : null);
const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** Checked, then listed, then found; the directory's own order inside a band. */
export function shapeResources(rows: readonly ResourceRowLike[], max = DIRECTORY_MAX_EACH): DirectoryResource[] {
  const rank = (b: unknown) => (b === "A" ? 0 : b === "B" ? 1 : 2);
  return rows.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r.band) - rank(y.r.band) || x.i - y.i).slice(0, max).map(({ r }) => {
    const band = r.band === "A" || r.band === "B" ? r.band : "C";
    const label = resourceEvidenceLabel(band, r.last_checked ?? null, r.band_reason ?? null);
    const area = r.area_id && (RESOURCE_AREAS as readonly string[]).includes(r.area_id) ? AREA_WORDS[r.area_id as ResourceArea] : null;
    const where = r.geo_scope === "national" ? "Anywhere in the US" : r.geo_scope === "statewide" ? `Anywhere in ${r.state ?? "the state"}` : [r.city, r.county, r.state].filter(Boolean).join(", ") || null;
    return {
      kind: "resource" as const, id: r.service_id, name: r.service_name ? `${r.org_name}: ${r.service_name}` : r.org_name,
      organization: r.org_name, service: r.service_name ?? null, need: area ?? r.area_label ?? "Help",
      band, howSure: label.label, howSureDetail: label.detail, lastChecked: day(r.last_checked),
      phone: text(r.phone, 40), hours: text(r.hours, 200), website: httpUrl(r.website), where,
      eligibility: text(r.eligibility, 300), source: httpUrl(r.source_url),
    };
  });
}

/**
 * The mark first, then reported. Inside a band, employers in the typed city
 * come first. A row past its recheck date is never shown (the reader already
 * drops them; this holds if one slips through).
 */
export function shapeEmployers(rows: readonly EmployerRowLike[], opts: { city?: string | null; today?: string; max?: number } = {}): DirectoryEmployer[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const city = (opts.city ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const inCity = (r: EmployerRowLike) => (city && (r.city ?? "").toLowerCase().replace(/[^a-z]/g, "") === city ? 0 : 1);
  const rank = (b: unknown) => (b === "A" ? 0 : 1);
  return rows
    .filter((r) => r.band === "A" || r.band === "B")
    .filter((r) => !day(r.expiresAt) || day(r.expiresAt)! > today)
    .map((r, i) => ({ r, i }))
    .sort((x, y) => rank(x.r.band) - rank(y.r.band) || inCity(x.r) - inCity(y.r) || x.i - y.i)
    .slice(0, opts.max ?? DIRECTORY_MAX_EACH)
    .map(({ r }) => ({
      kind: "employer" as const, id: r.id, name: r.name, industry: text(r.industry, 80),
      where: text(r.location, 120) ?? ([r.city, r.state].filter(Boolean).join(", ") || null),
      band: r.band as "A" | "B", howSure: employerEvidenceLabel(r.band),
      evidenceOn: day(r.checkedAt), recheckBy: day(r.expiresAt), roles: text(r.roleTypes, 200),
      evidence: text(r.evidence, 300), caveats: text(r.caveats, 200), apply: httpUrl(r.applyUrl), source: httpUrl(r.sourceUrl),
    }));
}

/** Sectors to filter by: the industries in what came back, sorted. */
export function sectorsOf(rows: readonly { industry?: string | null }[]): string[] {
  return [...new Set(rows.map((r) => (r.industry ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 40);
}

/** What the page says under a result list, in plain words. */
export const DIRECTORY_WORDS = {
  mark: "A mark is about how an employer has hired where the evidence was found. It never promises a job, or that someone's record will be accepted.",
  checkFirst: "Check before you send someone: hours and intake change.",
  emptyHelp: "No listing for this place and kind of help. That is a gap in our directory, not proof there is no help there.",
  emptyEmployers: "No employer listing for this search. That is a gap in our directory, not proof nobody there hires people with records.",
  needsPlace: "Type a town, county or ZIP, with the state (for example: Detroit, MI).",
} as const;
