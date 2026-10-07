/**
 * Read a US state code back out of the location a person saved in the Forge.
 *
 * The Forge saves locations in a few shapes, all ending in the state:
 *   "Milwaukee, WI"            a place picked from the list
 *   "Milwaukee, WI 53202"      a ZIP picked from the list
 *   "Lincoln County, MT"       a county picked from the list
 *   "53202 (Milwaukee, WI)"    an older or hand-typed ZIP form
 *   "Libby, Montana"           free text with the state spelled out
 *
 * Anything else (a bare ZIP, a town with no state) returns null: no state
 * given means no state, and callers must never guess one.
 *
 * Pure, no imports, so the server routes and the tests share one parser.
 */

export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

export function isStateCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(US_STATE_NAMES, code);
}

/** USPS code for a two-letter code or a full state name, any case; null otherwise. */
export function stateCodeFrom(token: string): string | null {
  const t = token.trim().replace(/\.$/, "");
  if (!t) return null;
  const upper = t.toUpperCase();
  if (t.length === 2 && isStateCode(upper)) return upper;
  return NAME_TO_CODE[t.toLowerCase()] ?? null;
}

/**
 * USPS state code from a saved Forge location, or null.
 * The state must come last and follow a comma, so "Portland or something"
 * never reads as Oregon, while a typed "portland, or" does. Any case.
 */
export function parseStateCode(location: unknown): string | null {
  if (typeof location !== "string") return null;
  const s = location.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!s) return null;

  // "53202 (Milwaukee, WI)": read inside the parentheses.
  const paren = s.match(/\(([^()]*)\)\s*$/);
  const body = paren ? paren[1].trim() : s;

  // ", ST" or ", ST 12345" or ", ST 12345-6789" at the end.
  const code = body.match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (code && isStateCode(code[1].toUpperCase())) return code[1].toUpperCase();

  // ", State Name" (optionally followed by a ZIP) at the end.
  const named = body.match(/,\s*([A-Za-z][A-Za-z. ]*[A-Za-z.])(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (named) {
    const fromName = NAME_TO_CODE[named[1].replace(/\.$/, "").toLowerCase()];
    if (fromName) return fromName;
  }
  return null;
}
