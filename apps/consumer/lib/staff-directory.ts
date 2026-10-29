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
  /** The phone field exactly as listed (never cut). */
  phone: string | null;
  /** The same field split into numbers, each with its own label; tel only for a whole US number. */
  phones: PhonePart[];
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
  /** True when a city was typed and this listing is in it. Local listings come first. */
  inPlace: boolean;
}

/** One number from a phone field: "Youth Housing Crisis Hotline" + "877-833-3680". */
export interface PhonePart {
  /** The words before the number ("Main line", "Youth Housing Crisis Hotline"), if any. */
  label: string | null;
  /** The number as listed, with any extension. */
  number: string;
  /** "tel:+18778333680" only when the number is a whole US number (10 digits, or 11 starting with 1). */
  tel: string | null;
}

// A US-shaped number: optional +1, area code (with or without parentheses), 3 + 4 digits, optional extension.
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const CONNECTOR = /^(?:[\s,;:|/&-]|\b(?:or|and|call|phone|tel)\b)+|(?:[\s,;:|/&(-]|\b(?:or|and)\b)+$/gi;

/** The tel: link for one number, or null when it does not parse to a whole US number. Never dials. */
export function telHref(number: string): string | null {
  const main = number.replace(/\s*(?:x|ext\.?|extension)\s*\d{1,6}$/i, "");
  const d = main.replace(/\D/g, "");
  if (d.length === 10 && /^[2-9]/.test(d)) return `tel:+1${d}`;
  if (d.length === 11 && d[0] === "1" && /^[2-9]/.test(d.slice(1))) return `tel:+${d}`;
  return null;
}

/**
 * Split a listed phone field into its numbers. Some listings hold several
 * ("Main 517-555-0100; Youth Housing Crisis Hotline 877-833-3680"), and a
 * single tel link built from all the digits dials nothing real. Text that
 * holds no whole number comes back as one part with no link.
 */
export function splitPhones(raw: string | null | undefined): PhonePart[] {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const parts: PhonePart[] = [];
  let last = 0;
  for (const m of s.matchAll(PHONE_RE)) {
    const at = m.index ?? 0;
    // A digit right before or after means this is part of a longer run, not a phone number.
    if (/\d/.test(s[at - 1] ?? "") || /\d/.test(s[at + m[0].length] ?? "")) continue;
    const label = s.slice(last, at).replace(CONNECTOR, "").trim();
    parts.push({ label: label || null, number: m[0].trim(), tel: telHref(m[0]) });
    last = at + m[0].length;
  }
  if (parts.length === 0) return [{ label: null, number: s, tel: null }];
  const tail = s.slice(last).replace(CONNECTOR, "").replace(/^\(|\)$/g, "").trim();
  if (tail) {
    const p = parts[parts.length - 1];
    parts[parts.length - 1] = { ...p, number: `${p.number} (${tail})` };
  }
  return parts;
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
/**
 * Listing text, whole when it fits. A long field is cut at a word boundary
 * and says so with "...", never in the middle of a word or a number.
 */
export function clipText(v: unknown, n: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > n * 0.6 ? cut.slice(0, space) : s.slice(0, n)).replace(/[\s,;:.(-]+$/, "");
  return `${head}...`;
}
const text = clipText;
/** Plenty for real listings; the cuts only stop a runaway field from flooding the page. */
export const TEXT_LIMITS = { phone: 600, hours: 500, eligibility: 900, industry: 120, location: 240, roles: 400, evidence: 900, caveats: 700 } as const;

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
      phone: text(r.phone, TEXT_LIMITS.phone), phones: splitPhones(text(r.phone, TEXT_LIMITS.phone)), hours: text(r.hours, TEXT_LIMITS.hours), website: httpUrl(r.website), where,
      eligibility: text(r.eligibility, TEXT_LIMITS.eligibility), source: httpUrl(r.source_url),
    };
  });
}

/** The fold the employer query ranks on: letters only ("Grand Rapids" -> "grandrapids"). Same in SQL. */
export function cityFold(v: string | null | undefined): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Employers in the typed city first, then the rest of the state; inside each,
 * the mark (A) before reported (B). The city is a preference, not a filter:
 * the query ranks the city first before its limit (publishedEmployerSql
 * city), so local listings are never pushed out by the statewide cap. A row
 * past its recheck date is never shown (the reader already drops them; this
 * holds if one slips through).
 */
export function shapeEmployers(rows: readonly EmployerRowLike[], opts: { city?: string | null; today?: string; max?: number } = {}): DirectoryEmployer[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const city = cityFold(opts.city);
  const isLocal = (r: EmployerRowLike) => !!city && cityFold(r.city) === city;
  const rank = (b: unknown) => (b === "A" ? 0 : 1);
  return rows
    .filter((r) => r.band === "A" || r.band === "B")
    .filter((r) => !day(r.expiresAt) || day(r.expiresAt)! > today)
    .map((r, i) => ({ r, i }))
    .sort((x, y) => Number(isLocal(y.r)) - Number(isLocal(x.r)) || rank(x.r.band) - rank(y.r.band) || x.i - y.i)
    .slice(0, opts.max ?? DIRECTORY_MAX_EACH)
    .map(({ r }) => ({
      kind: "employer" as const, id: r.id, name: r.name, industry: text(r.industry, TEXT_LIMITS.industry),
      where: text(r.location, TEXT_LIMITS.location) ?? ([r.city, r.state].filter(Boolean).join(", ") || null),
      band: r.band as "A" | "B", howSure: employerEvidenceLabel(r.band),
      evidenceOn: day(r.checkedAt), recheckBy: day(r.expiresAt), roles: text(r.roleTypes, TEXT_LIMITS.roles),
      evidence: text(r.evidence, TEXT_LIMITS.evidence), caveats: text(r.caveats, TEXT_LIMITS.caveats), apply: httpUrl(r.applyUrl), source: httpUrl(r.sourceUrl),
      inPlace: isLocal(r),
    }));
}

export interface EmployerGroup { key: "local" | "elsewhere" | "all"; heading: string | null; note: string | null; employers: DirectoryEmployer[] }

/**
 * How the employer list is labeled, honestly: "In Lansing" then "Elsewhere
 * in Michigan" when a city was typed; one list when it was not. When the city
 * has nothing listed, the page says so before showing the rest of the state.
 */
export function employerGroups(employers: readonly DirectoryEmployer[], place: { cityName?: string | null; stateName?: string | null }): EmployerGroup[] {
  const state = place.stateName || "the state";
  if (!place.cityName) return [{ key: "all", heading: null, note: null, employers: [...employers] }];
  const local = employers.filter((e) => e.inPlace);
  const rest = employers.filter((e) => !e.inPlace);
  const out: EmployerGroup[] = [];
  if (local.length) out.push({ key: "local", heading: `In ${place.cityName}`, note: null, employers: local });
  if (rest.length) out.push({
    key: "elsewhere", heading: `Elsewhere in ${state}`,
    note: local.length ? null : `No employer listed in ${place.cityName} for this search yet. These are elsewhere in ${state}.`,
    employers: rest,
  });
  return out;
}

/**
 * Rows for the state being searched, and nothing tagged to another state.
 * The resource reader always adds national rows, and some of those are one
 * state's offices (a Social Security field office listed for Missouri); a
 * Michigan search should not offer them. A national row with no state stays.
 */
export function inPickedState<T extends { state?: string | null }>(rows: readonly T[], state: string): T[] {
  const st = state.toUpperCase();
  return rows.filter((r) => !r.state || r.state.toUpperCase() === st);
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
