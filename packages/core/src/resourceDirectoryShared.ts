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
}

/**
 * Rows for some areas that reach the place: national rows always; when the
 * state is known, that state's statewide rows, and its county, multi-county
 * and city rows that match the place's counties, city or ZIP. The place match
 * runs here, BEFORE the row limit, and the closest rows come first, so a big
 * state cannot push the person's own county out of the first 200 (review M1).
 * The app re-checks every row with the same rules (support-search scopeCovers).
 */
export function resourceAppSql(opts: ResourcePlaceQuery): { sql: string; params: unknown[] } {
  const areas = opts.areas.filter(isResourceArea);
  const state = typeof opts.state === "string" && /^[A-Z]{2}$/.test(opts.state) ? opts.state : null;
  const params: unknown[] = [areas];
  let where = "area_id = ANY($1::text[]) AND ";
  if (state) {
    const countyKeys = [...new Set((opts.countyKeys ?? []).map(cleanKey).filter((k): k is string => !!k))].slice(0, 10);
    const cityKey = cleanKey(opts.cityKey);
    const zip = typeof opts.zip === "string" && /^\d{5}$/.test(opts.zip) ? opts.zip : null;
    params.push(state, countyKeys, cityKey, zip);
    const city = `${sqlFold("city")} = $4::text`;
    const zipHit = "left(zip, 5) = $5::text";
    where += `(geo_scope = 'national' OR (state = $2 AND (
           geo_scope = 'statewide'
        OR (geo_scope IN ('county', 'multi_county') AND (
             ${sqlFoldCounty("county")} = ANY($3::text[])
          OR EXISTS (SELECT 1 FROM unnest(counties) AS c(n) WHERE ${sqlFoldCounty("c.n")} = ANY($3::text[]))
          OR ${city}
          OR ${zipHit}))
        OR (geo_scope = 'city' AND (${city} OR ${zipHit})))))`;
  } else {
    where += "geo_scope = 'national'";
  }
  params.push(RESOURCE_APP_LIMIT);
  return {
    sql: `SELECT service_id, org_name, service_name, description, eligibility, area_id, area_label,
            geo_scope, state, county, counties, city, address, zip, phone, hours, website,
            source_url, last_checked::text AS last_checked
       FROM resource_app_v
      WHERE ${where}
      ORDER BY CASE geo_scope WHEN 'city' THEN 0 WHEN 'county' THEN 1 WHEN 'multi_county' THEN 1
                              WHEN 'statewide' THEN 2 ELSE 3 END,
               last_checked DESC, org_name, service_id
      LIMIT $${params.length}`,
    params,
  };
}
