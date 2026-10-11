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
import { foldName } from "./location-search";

export interface Place {
  /** USPS code, or null when the state could not be read. */
  state: string | null;
  /** Folded for matching (lib/location-search foldName). */
  cityKey: string | null;
  /** Folded, without the word "county", when the person named a county. */
  countyKey: string | null;
  /**
   * Every county the place sits in, folded: the named county, or the counties
   * a city or ZIP falls in (filled by the server from the Census list,
   * lib/support-place-index.ts). Empty when unknown.
   */
  countyKeys: string[];
  zip: string | null;
  /**
   * A short label to show back: "Libby, MT", "Lincoln County, MT", "MT 59923".
   * Built from the person's own words (whitespace tidied, title-cased, at most
   * 60 characters) plus the state code. It is NOT checked against the Census
   * list, so treat it as their text: React escapes it, it is never logged, and
   * HUD is sent it only when no ZIP was given.
   */
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

/**
 * Single ZIPs whose post office is in a different state from the rest of
 * their three-digit prefix (review L3). ZIPs that straddle a state line but
 * whose post office is in the prefix's state (42223 Fort Campbell, 59221
 * Fairview, 97635 New Pine Creek) keep the prefix's state; a typed state wins.
 */
const ZIP_STATE_OVERRIDES: Record<string, string> = {
  "06390": "NY", // Fishers Island, NY, inside Connecticut's 063 prefix
  "96799": "AS", // Pago Pago, American Samoa, inside Hawaii's 967 prefix
  "83414": "WY", // Alta, WY, served through Idaho's 834 prefix
};
/** The shared Pacific prefix 969: Guam and the Northern Mariana Islands by exact range; the rest give no state. */
const ZIP_RANGE_OVERRIDES: Array<[number, number, string]> = [
  [96910, 96932, "GU"],
  [96950, 96952, "MP"],
];

/** State for a 5-digit ZIP, from its prefix; null when the prefix gives none. */
export function stateFromZip(zip: string): string | null {
  if (!/^\d{5}$/.test(zip)) return null;
  if (Object.prototype.hasOwnProperty.call(ZIP_STATE_OVERRIDES, zip)) return ZIP_STATE_OVERRIDES[zip];
  const n = parseInt(zip, 10);
  for (const [lo, hi, st] of ZIP_RANGE_OVERRIDES) if (n >= lo && n <= hi) return st;
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

export const DC_COUNTY_KEY = "district of columbia";

const EMPTY: Place = { state: null, cityKey: null, countyKey: null, countyKeys: [], zip: null, label: null, given: false };

export interface ParseOptions {
  /**
   * Is this folded name a Census place in this state? Lets "libby mt" read as
   * Montana while "near me" never reads as Maine (lib/support-place-index.ts).
   */
  isPlaceIn?: (cityKey: string, state: string) => boolean;
}

/**
 * The state from text with no comma (review M2). A trailing full state name
 * counts ("libby montana", "columbus new york"). A trailing two-letter code
 * counts only when it is typed in capitals ("Libby MT") or the words before
 * it are a Census place in that state ("libby mt"): ordinary words like "me",
 * "in", "hi", "or", "ok" are not states. The text alone counts when it is a
 * full state name, or a two-letter code in capitals.
 */
function stateWithoutComma(text: string, opts: ParseOptions): { state: string | null; name: string } {
  if (!text) return { state: null, name: "" };
  const whole = stateCodeFrom(text);
  if (whole) {
    const isCode = text.replace(/\.$/, "").length === 2;
    return isCode && text !== text.toUpperCase() ? { state: null, name: text } : { state: whole, name: "" };
  }
  const words = text.split(" ");
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const tail = words.slice(-take).join(" ");
    const st = stateCodeFrom(tail);
    if (!st) continue;
    const before = words.slice(0, -take).join(" ");
    if (tail.replace(/\.$/, "").length === 2) {
      const caps = tail === tail.toUpperCase();
      let known = false;
      try { known = !!opts.isPlaceIn?.(foldName(before), st); } catch { known = false; }
      if (!caps && !known) continue;
    }
    return { state: st, name: before };
  }
  return { state: null, name: text };
}

export function parsePlace(location: unknown, opts: ParseOptions = {}): Place {
  if (typeof location !== "string") return EMPTY;
  let s = location.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!s) return EMPTY;

  // "53202 (Milwaukee, WI)": the place is inside the parentheses.
  const paren = s.match(/^(\d{5}(?:-\d{4})?)\s*\(([^()]*)\)\s*$/);
  if (paren) s = `${paren[2].trim()} ${paren[1]}`;

  const zipMatch = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  const zipState = zip ? stateFromZip(zip) : null;
  const withoutZip = s.replace(/\b\d{5}(?:-\d{4})?\b/g, " ").replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim();

  // The state: ", ST" / ", State" at the end (the Forge's saved shapes, any
  // case), else a state typed without a comma (stateWithoutComma), else the
  // ZIP's prefix.
  let state: string | null = null;
  let name = withoutZip;
  const commaState = parseStateCode(s);
  if (commaState) {
    state = commaState;
    name = withoutZip.slice(0, Math.max(0, withoutZip.lastIndexOf(",")));
  } else if (!withoutZip.includes(",")) {
    ({ state, name } = stateWithoutComma(withoutZip, opts));
  }
  // A typed state beats a ZIP that points elsewhere; the ZIP is then dropped as a typo.
  const zipKept = zip && (!state || !zipState || zipState === state) ? zip : null;
  if (!state) state = zipState;

  // "PO Box 12, Libby": the place is the last part before the state.
  name = name.replace(/[,\s]+$/, "").trim();
  if (name.includes(",")) name = name.slice(name.lastIndexOf(",") + 1).trim();
  if (/^\d*$/.test(name) || /^(po|p o) box\b/i.test(name)) name = "";

  let cityKey: string | null = null;
  let countyKey: string | null = null;
  let shown: string | null = null;
  if (name) {
    if (COUNTY_RE.test(name)) countyKey = countyKeyOf(name) || null;
    else cityKey = foldName(name) || null;
    if (cityKey || countyKey) shown = name.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  let label: string | null = null;
  if (state && shown) label = `${shown.slice(0, 60)}, ${state}`;
  else if (state && zipKept) label = `${state} ${zipKept}`;
  else if (state) label = stateName(state) ?? state;

  // DC is one county-level unit, the District of Columbia (review L2).
  const countyKeys = [...new Set([...(countyKey ? [countyKey] : []), ...(state === "DC" ? [DC_COUNTY_KEY] : [])])];
  return { state, cityKey, countyKey, countyKeys, zip: zipKept, label, given: true };
}
