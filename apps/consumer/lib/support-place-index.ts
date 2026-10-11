/**
 * Which counties a city or ZIP sits in, for the support search, from the same
 * public US Census list the Forge's location field uses
 * (public/forge-data/us-places-2020.v1.json, lib/location-search.ts).
 *
 * Why: most checked listings reach a county, and people type a town. Without
 * this, "Kalispell, MT" would never meet a Flathead County listing. The list
 * maps each ZIP to its main place and county; a city's counties are the
 * counties of its ZIPs.
 *
 * Server only. The file is read once per server instance, lazily, from disk
 * (next.config.ts traces it into the route). Any failure gives no counties,
 * never an error: city and ZIP matching still work.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLocationIndex, type LocationIndex, type RawLocationData } from "./location-search";
import { countyKeyOf, type Place } from "./support-location";

export const PLACE_FILE = join("public", "forge-data", "us-places-2020.v1.json");

let cached: LocationIndex | null | undefined;

export function loadPlaceIndex(file = join(process.cwd(), PLACE_FILE)): LocationIndex | null {
  if (cached !== undefined) return cached;
  try {
    cached = buildLocationIndex(JSON.parse(readFileSync(file, "utf8")) as RawLocationData);
  } catch {
    cached = null;
  }
  return cached;
}

/** Folded county keys for a place's city or ZIP, in its own state only. */
export function countiesIn(index: LocationIndex, place: Place): string[] {
  if (!place.state) return [];
  const out = new Set<string>();
  const add = (c: number) => {
    const county = c >= 0 ? index.counties[c] : null;
    if (county && county.st === place.state) out.add(countyKeyOf(county.name));
  };
  if (place.zip) {
    const hit = index.zips.get(place.zip);
    if (hit) add(hit[1]);
  }
  if (place.cityKey) {
    const placeIdx = new Set<number>();
    index.places.forEach((p, i) => { if (p.st === place.state && p.key === place.cityKey) placeIdx.add(i); });
    if (placeIdx.size) for (const [p, c] of index.zips.values()) if (placeIdx.has(p)) add(c);
  }
  return [...out];
}

export function countiesOf(place: Place): string[] {
  const index = loadPlaceIndex();
  return index ? countiesIn(index, place) : [];
}
