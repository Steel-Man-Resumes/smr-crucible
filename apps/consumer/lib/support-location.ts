/**
 * Where a person is, read from the location they typed or picked, for the
 * support search (Phase 5 lane R3, Codex A4).
 *
 * The old search knew one word, "montana". Everyone else got Wisconsin. This
 * reads a state, a city or county, and a ZIP, and never guesses: a town with
 * no state ("Springfield") has no state, and the search then shows only
 * services that work anywhere, with a line saying why.
 *
 * Shapes it reads:
 *   "Milwaukee, WI"            "Milwaukee, WI 53202"     "Lincoln County, MT"
 *   "53202 (Milwaukee, WI)"    "Libby, Montana"          "libby mt"
 *   "59923"  (a bare ZIP: the state comes from its first three digits)
 *   "Ohio"   (a state alone)
 *
 * Pure, no imports beyond the shared location helpers, so the route and the
 * tests share one parser.
 */

import { parseStateCode, stateCodeFrom, US_STATE_NAMES } from "./location-state";
import { foldName, splitQuery } from "./location-search";

export interface Place {
  /** USPS code, or null when the state could not be read. */
  state: string | null;
  /** Folded for matching (lib/location-search foldName). */
  cityKey: string | null;
  /** Folded, without the word "county". */
  countyKey: string | null;
  zip: string | null;
  /** A short, normalised label to show back: "Libby, MT", "Lincoln County, MT", "MT 59923". Never the raw text. */
  label: string | null;
  /** True when the person typed something (so "no state" is a parse miss, not a blank field). */
  given: boolean;
}

/**
 * ZIP prefix (first three digits) to state. USPS assigns each three-digit
 * prefix to one sectional center, which sits in one state. Military (AA, AE,
 * AP) and the shared Pacific prefix are left out: they give no state.
 */
const ZIP3_RANGES: Array<[number, number, string]> = [
  [5, 5, "NY"], [6, 7, "PR"], [8, 8, "VI"], [9, 9, "PR"],
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"],
  [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"],
  [200, 200, "DC"], [201, 201, "VA"], [202, 205, "DC"], [206, 219, "MD"],
  [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"],
  [300, 319, "GA"], [320, 339, "FL"], [341, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"],
  [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"],
  [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"],
  [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"],
  [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [730, 731, "OK"],
  [733, 733, "TX"], [734, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
  [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"],
  [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

/** State for a 5-digit ZIP, from its prefix; null when the prefix gives none. */
export function stateFromZip(zip: string): string | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const p = parseInt(zip.slice(0, 3), 10);
  for (const [lo, hi, st] of ZIP3_RANGES) if (p >= lo && p <= hi) return st;
  return null;
}

const COUNTY_RE = /\s+(county|parish|borough)$/i;

export function countyKeyOf(name: string): string {
  return foldName(name.replace(COUNTY_RE, ""));
}

export function stateName(code: string | null): string | null {
  return code ? US_STATE_NAMES[code] ?? null : null;
}

const EMPTY: Place = { state: null, cityKey: null, countyKey: null, zip: null, label: null, given: false };

export function parsePlace(location: unknown): Place {
  if (typeof location !== "string") return EMPTY;
  let s = location.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!s) return EMPTY;

  // "53202 (Milwaukee, WI)": the place is inside the parentheses.
  const paren = s.match(/^(\d{5}(?:-\d{4})?)\s*\(([^()]*)\)\s*$/);
  if (paren) s = `${paren[2].trim()} ${paren[1]}`;

  const zipMatch = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  const zipState = zip ? stateFromZip(zip) : null;

  // The state: ", ST" / ", State" at the end (the Forge's saved shapes), then
  // a typed trailing state ("libby mt", "libby montana"), then a state alone,
  // then the ZIP's prefix.
  const withoutZip = s.replace(/\b\d{5}(?:-\d{4})?\b/g, " ").replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim();
  const split = splitQuery(withoutZip);
  let state = parseStateCode(s) ?? split.state ?? (withoutZip ? stateCodeFrom(withoutZip) : null);
  const stateOnly = !!withoutZip && stateCodeFrom(withoutZip) === state && !split.state && !parseStateCode(s);
  // A typed state beats a ZIP that points elsewhere; the ZIP is then dropped as a typo.
  const zipKept = zip && (!state || !zipState || zipState === state) ? zip : null;
  if (!state) state = zipState;

  let name = stateOnly ? "" : (split.state || parseStateCode(s) ? split.name : withoutZip);
  name = name.replace(/[,\s]+$/, "").trim();
  if (/^\d*$/.test(name)) name = "";

  let cityKey: string | null = null;
  let countyKey: string | null = null;
  let shown: string | null = null;
  if (name) {
    if (COUNTY_RE.test(name)) {
      countyKey = countyKeyOf(name);
      shown = name.replace(/\b\w/g, (c) => c.toUpperCase());
    } else {
      cityKey = foldName(name);
      shown = name.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    if (!cityKey && !countyKey) shown = null;
  }

  let label: string | null = null;
  if (state && shown) label = `${shown.slice(0, 60)}, ${state}`;
  else if (state && zipKept) label = `${state} ${zipKept}`;
  else if (state) label = stateName(state) ?? state;

  return { state, cityKey, countyKey, zip: zipKept, label, given: true };
}
