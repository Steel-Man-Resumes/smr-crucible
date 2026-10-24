/**
 * The checked resource directory, as the app may see it (migration 082,
 * resource_app_v). Pure: the row shape, the area names and the SQL, so the
 * consumer route and the tests share them without a database.
 *
 * resource_app_v holds only services whose newest check passed review, is
 * fresh, unchanged since it was checked, not low confidence and not dataset
 * only (all decided in 072's resource_public_v), from an active org. The app
 * role can read that view and nothing underneath it.
 */

export type ResourceGeoScope = "city" | "county" | "multi_county" | "statewide" | "national";

/** One row of resource_app_v. Dates are YYYY-MM-DD strings. */
export interface ResourceAppRow {
  service_id: string;
  org_name: string;
  service_name: string | null;
  description: string;
  eligibility: string | null;
  area_id: string;
  area_label: string;
  geo_scope: ResourceGeoScope;
  state: string;
  county: string | null;
  counties: string[] | null;
  city: string | null;
  address: string | null;
  zip: string | null;
  phone: string | null;
  hours: string | null;
  website: string | null;
  source_url: string;
  last_checked: string;
}

/** The 072 areas (resource_area). */
export const RESOURCE_AREAS = [
  "shelter", "food", "clothing", "safety", "physical", "mental", "recovery",
  "id_documents", "legal_aid", "expungement", "courts", "jobs", "training",
  "education", "financial", "community", "faith", "veterans", "youth", "transportation",
] as const;
export type ResourceArea = (typeof RESOURCE_AREAS)[number];

export function isResourceArea(s: unknown): s is ResourceArea {
  return typeof s === "string" && (RESOURCE_AREAS as readonly string[]).includes(s);
}

export const RESOURCE_APP_LIMIT = 200;
/**
 * Each reach level (city, county, statewide, national) gets at most this many
 * rows, so the page is at most RESOURCE_APP_LIMIT and no level can push another
 * off it: a state with hundreds of statewide rows still leaves room for its
 * counties and for national lines (review N3).
 */
export const RESOURCE_APP_LEVEL_CAP = RESOURCE_APP_LIMIT / 4;

/**
 * SQL that folds a name the way the app's foldName does
 * (apps/consumer/lib/location-search.ts): lowercase, common accents off,
 * dots and apostrophes dropped, other punctuation to spaces, saint/fort/mount
 * shortened. Only accents that Unicode NFD splits are listed, so both sides
 * agree. The PGlite proof compares the two on a list of real place names.
 */
const ACCENTS: Array<[string, string]> = [
  ..."áàâäãåā".split("").map((c): [string, string] => [c, "a"]),
  ..."éèêëē".split("").map((c): [string, string] => [c, "e"]),
  ..."íìîïī".split("").map((c): [string, string] => [c, "i"]),
  ..."óòôöõō".split("").map((c): [string, string] => [c, "o"]),
  ..."úùûüū".split("").map((c): [string, string] => [c, "u"]),
  ["ñ", "n"], ["ç", "c"], ["ÿ", "y"],
];

export function sqlFold(expr: string): string {
  const accents = ACCENTS.map(([a]) => a).join("");
  const plain = ACCENTS.map(([, b]) => b).join("");
  return `btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(`
    + `translate(lower(${expr}), '${accents}', '${plain}'), '[.''’]', '', 'g'), '[^a-z0-9]+', ' ', 'g'), `
    + `'\\msaint\\M', 'st', 'g'), '\\mfort\\M', 'ft', 'g'), '\\mmount\\M', 'mt', 'g'))`;
}

/** As the app's countyKeyOf: the word county / parish / borough off the end, then folded. */
export function sqlFoldCounty(expr: string): string {
  return sqlFold(`regexp_replace(${expr}, '\\s+(county|parish|borough)$', '', 'i')`);
}

const KEY_RE = /^[a-z0-9]+( [a-z0-9]+)*$/;
const cleanKey = (k: unknown): string | null => (typeof k === "string" && k.length <= 80 && KEY_RE.test(k) ? k : null);

export interface ResourcePlaceQuery {
  state: string | null;
  areas: readonly string[];
  /** Folded county keys the place sits in (countyKeyOf). */
  countyKeys?: readonly string[];
  /** Folded city name (foldName). */
  cityKey?: string | null;
  zip?: string | null;
  /** A state page: every row in the state (any county or city) plus national rows. */
  wholeState?: boolean;
}

/**
 * Rows for some areas that reach the place: national rows always; when the
 * state is known, that state's statewide rows, and its county, multi-county
 * and city rows that match the place's counties, city or ZIP. The place match
 * runs here, BEFORE the row limit, so a big state cannot push the person's own
 * county off the page (review M1), and each reach level is capped on its own
 * (RESOURCE_APP_LEVEL_CAP), so national lines cannot be pushed off either
 * (review N3). Closest first, newest first within a level.
 * The app re-checks every row with the same rules (support-search scopeCovers).
 */
/** The place match shared by the app read and the public bands: WHERE text and its parameters. */
export function resourcePlaceWhere(opts: ResourcePlaceQuery): { where: string; params: unknown[] } {
  const areas = opts.areas.filter(isResourceArea);
  const state = typeof opts.state === "string" && /^[A-Z]{2}$/.test(opts.state) ? opts.state : null;
  const params: unknown[] = [areas];
  let where = "area_id = ANY($1::text[]) AND ";
  if (state) {
    const countyKeys = [...new Set((opts.countyKeys ?? []).map(cleanKey).filter((k): k is string => !!k))].slice(0, 10);
    const cityKey = cleanKey(opts.cityKey);
    const zip = typeof opts.zip === "string" && /^\d{5}$/.test(opts.zip) ? opts.zip : null;
    if (opts.wholeState) {
      // A state page: every row that reaches somewhere in the state, plus national rows.
      // Only the state is bound: an unused bind parameter has no type and Postgres rejects the query.
      params.push(state);
      where += "(geo_scope = 'national' OR state = $2)";
      return { where, params };
    }
    params.push(state, countyKeys, cityKey, zip);
    const city = `${sqlFold("city")} = $4::text`;
    const zipHit = "left(zip, 5) = $5::text";
    {
      where += `(geo_scope = 'national' OR (state = $2 AND (
           geo_scope = 'statewide'
        OR (geo_scope IN ('county', 'multi_county') AND (
             ${sqlFoldCounty("county")} = ANY($3::text[])
          OR EXISTS (SELECT 1 FROM unnest(counties) AS c(n) WHERE ${sqlFoldCounty("c.n")} = ANY($3::text[]))
          OR ${city}
          OR ${zipHit}))
        OR (geo_scope = 'city' AND (${city} OR ${zipHit})))))`;
    }
  } else {
    where += "geo_scope = 'national'";
  }
  return { where, params };
}

export function resourceAppSql(opts: ResourcePlaceQuery): { sql: string; params: unknown[] } {
  const { where, params } = resourcePlaceWhere(opts);
  params.push(RESOURCE_APP_LEVEL_CAP);
  return {
    sql: `SELECT service_id, org_name, service_name, description, eligibility, area_id, area_label,
            geo_scope, state, county, counties, city, address, zip, phone, hours, website,
            source_url, last_checked
       FROM (
         SELECT m.*, row_number() OVER (PARTITION BY m.lvl ORDER BY m.last_checked DESC, m.org_name, m.service_id) AS rn
           FROM (
             SELECT service_id, org_name, service_name, description, eligibility, area_id, area_label,
                    geo_scope, state, county, counties, city, address, zip, phone, hours, website,
                    source_url, last_checked::text AS last_checked,
                    CASE geo_scope WHEN 'city' THEN 0 WHEN 'county' THEN 1 WHEN 'multi_county' THEN 1
                                   WHEN 'statewide' THEN 2 ELSE 3 END AS lvl
               FROM resource_app_v
              WHERE ${where}
           ) m
       ) r
      WHERE r.rn <= $${params.length}
      ORDER BY r.lvl, r.last_checked DESC, r.org_name, r.service_id`,
    params,
  };
}

// ─── Public bands (migration 089, Troy 2026-10-18) ──────────────────────────

/**
 * A  exactly the checked publication (resource_public_v): review passed, fresh, high or medium.
 * B  a dated public source but no passed review yet (partial, unverifiable, or T1 awaiting a name).
 * C  dataset-only, low confidence, or a check that lapsed within 90 days.
 * Best first, always; a seeker is never handed C above A.
 */
export const RESOURCE_BANDS = ["A", "B", "C"] as const;
export type ResourceBand = (typeof RESOURCE_BANDS)[number];
export const RESOURCE_BAND_LABELS: Record<ResourceBand, string> = {
  A: "Checked by Steel Man",
  B: "Listed, not yet checked by us",
  C: "Found, could not confirm. Call first.",
};
export function isResourceBand(s: unknown): s is ResourceBand {
  return typeof s === "string" && (RESOURCE_BANDS as readonly string[]).includes(s);
}
/** "ABC" or "A,B" from a query string to a clean band list; nothing recognisable means A only. */
export function parseBands(raw: unknown): ResourceBand[] {
  const picked = typeof raw === "string" ? [...raw.toUpperCase()].filter(isResourceBand) : [];
  const unique = RESOURCE_BANDS.filter((b) => picked.includes(b));
  return unique.length ? [...unique] : ["A"];
}

export const RESOURCE_BAND_FIELDS = `service_id,org_name,service_name,description,eligibility,area_id,area_label,geo_scope,
 state,county,counties,city,address,zip,phone,hours,website,source_url,last_checked::text AS last_checked,
 fees,what_to_bring,limits,expires_on::text AS expires_on,verification_tier,tier_confidence,corroboration_points,version,band,band_reason`;

/** A state page read by a trusted server (the public website): the whole state in pages of up to this many rows. */
export const RESOURCE_STATE_PAGE_SIZE = 200;
/** Highest page number served; with the page size this bounds one state to 12,200 rows. */
export const RESOURCE_STATE_PAGE_MAX = 60;
export interface ResourceStatePaging { page: number; limit: number }
/** Paging from a query string, or null when no page was asked for or it is out of range. */
export function resourceStatePaging(page: unknown, limit?: unknown): ResourceStatePaging | null {
  if (page === null || page === undefined || page === "") return null;
  const p = Number(page);
  if (!Number.isInteger(p) || p < 0 || p > RESOURCE_STATE_PAGE_MAX) return null;
  const l = limit === null || limit === undefined || limit === "" ? RESOURCE_STATE_PAGE_SIZE : Number(limit);
  return { page: p, limit: Number.isInteger(l) && l >= 1 ? Math.min(RESOURCE_STATE_PAGE_SIZE, l) : RESOURCE_STATE_PAGE_SIZE };
}

/**
 * Public rows from resource_band_publication_v for a place, in the bands asked for.
 * Each (band, reach level) pair is capped on its own at RESOURCE_APP_LEVEL_CAP, so the
 * poor band can never push the checked band off the page and a big state's dataset rows
 * cannot bury its own county. Order: band, then closest, then newest.
 *
 * `paging` (a state page read by a trusted server only, see the route) drops the cap and returns the whole
 * state in the same order, one page at a time. Without it nothing changes: a public caller still gets the
 * capped slice. 2026-10-24: the cap alone left Michigan's page showing 298 of 1,739 public services.
 */
export function resourceBandSql(opts: ResourcePlaceQuery & { bands?: readonly ResourceBand[]; paging?: ResourceStatePaging | null }): { sql: string; params: unknown[] } {
  const { where, params } = resourcePlaceWhere(opts);
  const bands = (opts.bands ?? ["A"]).filter(isResourceBand);
  params.push(bands.length ? bands : ["A"]);
  const bandAt = params.length;
  const paged = !!(opts.wholeState && opts.paging);
  if (paged) params.push(opts.paging!.limit, opts.paging!.page * opts.paging!.limit);
  else params.push(RESOURCE_APP_LEVEL_CAP);
  const plain = ["service_id", "org_name", "service_name", "description", "eligibility", "area_id", "area_label", "geo_scope",
    "state", "county", "counties", "city", "address", "zip", "phone", "hours", "website", "source_url",
    "fees", "what_to_bring", "limits", "verification_tier", "tier_confidence", "corroboration_points", "version", "band", "band_reason"];
  const inner = [...plain, "last_checked::text AS last_checked", "expires_on::text AS expires_on"].join(", ");
  const outer = [...plain, "last_checked", "expires_on"].map((f) => "r." + f).join(", ");
  if (paged) {
    return {
      sql: `SELECT ${outer}
       FROM (
         SELECT ${inner},
                CASE geo_scope WHEN 'city' THEN 0 WHEN 'county' THEN 1 WHEN 'multi_county' THEN 1
                               WHEN 'statewide' THEN 2 ELSE 3 END AS lvl
           FROM resource_band_publication_v
          WHERE ${where} AND band = ANY($${bandAt}::text[])
       ) r
      ORDER BY r.band, r.lvl, r.last_checked DESC, r.org_name, r.service_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    };
  }
  return {
    sql: `SELECT ${outer}
       FROM (
         SELECT m.*, row_number() OVER (PARTITION BY m.band, m.lvl ORDER BY m.last_checked DESC, m.org_name, m.service_id) AS rn
           FROM (
             SELECT ${inner},
                    CASE geo_scope WHEN 'city' THEN 0 WHEN 'county' THEN 1 WHEN 'multi_county' THEN 1
                                   WHEN 'statewide' THEN 2 ELSE 3 END AS lvl
               FROM resource_band_publication_v
              WHERE ${where} AND band = ANY($${bandAt}::text[])
           ) m
       ) r
      WHERE r.rn <= $${params.length}
      ORDER BY r.band, r.lvl, r.last_checked DESC, r.org_name, r.service_id`,
    params,
  };
}
