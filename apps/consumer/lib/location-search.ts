/**
 * Location suggestions for the Forge's "Where are you located?" field.
 *
 * The data is a public US Census list (places, counties, ZIP areas) built by
 * scripts/census-places/build_places.py and served as a static file. The page
 * fetches it once, when the field is first focused, and every search runs
 * here in the person's browser: what they type is never sent anywhere.
 *
 * Saved values always end in the state, the shape the analyze route reads
 * (lib/location-state.ts):
 *   place   "Milwaukee, WI"
 *   ZIP     "Milwaukee, WI 53202"
 *   county  "Lincoln County, MT"
 * Free text is always allowed: a place missing from the list still saves.
 *
 * Pure functions only, so the search is unit tested without a browser.
 */

import { stateCodeFrom } from "./location-state";

export const LOCATION_DATA_URL = "/forge-data/us-places-2020.v1.json";

/** The file's shape (see the build script). */
export interface RawLocationData {
  v: number;
  vintage?: string;
  source?: string;
  places: string[]; // "Name|ST", most likely first
  counties: string[]; // "Name County|ST"
  zips: { delta: number[]; place: number[]; county: number[] };
}

interface Entry {
  name: string;
  st: string;
  key: string; // folded name, for matching
}

export interface LocationIndex {
  places: Entry[];
  counties: Entry[];
  /** ZIP (5 digits) to [place index or -1, county index or -1]. */
  zips: Map<string, [number, number]>;
  /** Sorted ZIP strings, for prefix search. */
  zipList: string[];
}

export interface LocationSuggestion {
  kind: "place" | "zip" | "county";
  /** What the list shows. */
  label: string;
  /** Extra context shown beside the label (the county for a ZIP). */
  detail?: string;
  /** What gets saved. Always ends in ", ST" (plus a ZIP for a ZIP pick). */
  value: string;
  state: string;
}

/**
 * Fold a name for matching: lowercase, accents off, punctuation to spaces,
 * and the common short forms made equal, so "saint louis", "st louis" and
 * "St. Louis" all match.
 */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bsaint\b/g, "st")
    .replace(/\bfort\b/g, "ft")
    .replace(/\bmount\b/g, "mt")
    .replace(/\s+/g, " ");
}

function entry(raw: string): Entry {
  const bar = raw.lastIndexOf("|");
  const name = raw.slice(0, bar);
  return { name, st: raw.slice(bar + 1), key: foldName(name) };
}

export function buildLocationIndex(data: RawLocationData): LocationIndex {
  if (!data || !Array.isArray(data.places) || !data.zips) throw new Error("not a location file");
  const zips = new Map<string, [number, number]>();
  const zipList: string[] = [];
  let z = 0;
  const { delta, place, county } = data.zips;
  for (let i = 0; i < delta.length; i++) {
    z += delta[i];
    const zip = String(z).padStart(5, "0");
    zips.set(zip, [place[i] ?? -1, county[i] ?? -1]);
    zipList.push(zip);
  }
  return {
    places: data.places.map(entry),
    counties: (data.counties || []).map(entry),
    zips,
    zipList,
  };
}

export const placeValue = (name: string, st: string) => `${name}, ${st}`;

function zipSuggestion(index: LocationIndex, zip: string): LocationSuggestion | null {
  const hit = index.zips.get(zip);
  if (!hit) return null;
  const [p, c] = hit;
  const place = p >= 0 ? index.places[p] : null;
  const county = c >= 0 ? index.counties[c] : null;
  const where = place ?? county;
  if (!where) return null;
  return {
    kind: "zip",
    label: `${zip} (${where.name}, ${where.st})`,
    detail: place && county ? county.name : undefined,
    value: `${where.name}, ${where.st} ${zip}`,
    state: where.st,
  };
}

/** The saved value for an exact 5-digit ZIP, or null when the list does not have it. */
export function resolveZip(index: LocationIndex, zip: string): string | null {
  return /^\d{5}$/.test(zip.trim()) ? zipSuggestion(index, zip.trim())?.value ?? null : null;
}

/**
 * Split a typed query into the name part and an optional state at the end:
 * "milwaukee, wi", "milwaukee wi", "libby montana". A trailing token is only
 * read as a state when something comes before it, so "or" alone stays a name.
 */
export function splitQuery(q: string): { name: string; state: string | null } {
  const raw = q.replace(/\s+/g, " ").trim();
  const comma = raw.lastIndexOf(",");
  if (comma > 0) {
    const st = stateCodeFrom(raw.slice(comma + 1).replace(/\d{5}(-\d{4})?/, ""));
    if (st) return { name: raw.slice(0, comma), state: st };
    return { name: raw.slice(0, comma), state: null };
  }
  const words = raw.split(" ");
  for (const take of [2, 1]) {
    // "new york", "north dakota" as a trailing two-word state name
    if (words.length > take) {
      const st = stateCodeFrom(words.slice(-take).join(" "));
      if (st) return { name: words.slice(0, -take).join(" "), state: st };
    }
  }
  return { name: raw, state: null };
}

/**
 * Up to `limit` suggestions for what the person has typed so far.
 * - 3 to 5 digits: ZIP areas starting with them.
 * - Words: places whose name starts with them (or has a word that does), most
 *   likely first, then counties. A trailing state narrows the list; if that
 *   leaves nothing, the state is treated as part of the name instead.
 */
export function searchLocations(index: LocationIndex, query: string, limit = 8): LocationSuggestion[] {
  const q = query.trim();
  if (!q) return [];

  const digits = q.replace(/\s/g, "");
  if (/^\d{3,5}$/.test(digits)) {
    const out: LocationSuggestion[] = [];
    if (digits.length === 5) {
      const one = zipSuggestion(index, digits);
      return one ? [one] : [];
    }
    for (const zip of index.zipList) {
      if (zip.startsWith(digits)) {
        const s = zipSuggestion(index, zip);
        if (s) out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
  if (/^\d+$/.test(digits)) return [];

  const split = splitQuery(q);
  const attempt = (name: string, state: string | null) => {
    const key = foldName(name);
    if (!key) return [];
    const starts: LocationSuggestion[] = [];
    const words: LocationSuggestion[] = [];
    const scan = (list: Entry[], kind: "place" | "county") => {
      for (const e of list) {
        if (state && e.st !== state) continue;
        if (starts.length >= limit) return;
        const s: LocationSuggestion = {
          kind,
          label: placeValue(e.name, e.st),
          value: placeValue(e.name, e.st),
          state: e.st,
        };
        if (e.key.startsWith(key)) starts.push(s);
        else if (words.length < limit && e.key.includes(` ${key}`)) words.push(s);
      }
    };
    scan(index.places, "place");
    scan(index.counties, "county");
    return [...starts, ...words].slice(0, limit);
  };

  let results = attempt(split.name, split.state);
  if (!results.length && split.state) results = attempt(q.replace(/,/g, " "), null);
  return results;
}
