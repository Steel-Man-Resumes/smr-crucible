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
 * Rows for some areas that could cover a place in `state`: national rows
 * always, and that state's rows when a state is known. City and county
 * matching is finished in the app, where the person's place is parsed.
 */
export function resourceAppSql(opts: { state: string | null; areas: readonly string[] }): { sql: string; params: unknown[] } {
  const areas = opts.areas.filter(isResourceArea);
  const state = typeof opts.state === "string" && /^[A-Z]{2}$/.test(opts.state) ? opts.state : null;
  const params: unknown[] = [areas];
  let where = "area_id = ANY($1::text[]) AND ";
  if (state) {
    params.push(state);
    where += "(geo_scope = 'national' OR state = $2)";
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
      ORDER BY last_checked DESC, org_name, service_id
      LIMIT $${params.length}`,
    params,
  };
}
