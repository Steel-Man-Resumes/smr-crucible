/**
 * The organization's own state, for staff t.ROY's directory searches (demo
 * fix T2, 2026-10-28).
 *
 * THE GAP. "Find employers in Jackson that hire people with records" got
 * "Which state is Jackson in?" from a Michigan organization. find_employers
 * needs a two-letter state, and nothing told t.ROY where the organization is.
 *
 * WHERE THE STATE COMES FROM. There is no state or address column for an
 * organization (org_profile has a time zone, migration 103; access_code has a
 * name). So, in order, and only from organization facts, never a participant:
 *   1. org_profile.timezone, when the zone belongs to one state
 *      (America/Detroit is Michigan; America/Chicago is many states, so no);
 *   2. the organization's name, when it ends in a state code ("..., MI") or
 *      carries a state's full name ("Michigan Works Lansing").
 * Neither: no state, and t.ROY asks, as before.
 */
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

/** Zones used by one state only. Multi-state zones (New_York, Chicago, Denver, Los_Angeles) are left out on purpose. */
const ZONE_STATE: Readonly<Record<string, string>> = {
  "America/Detroit": "MI", "America/Menominee": "MI",
  "America/Boise": "ID", "America/Phoenix": "AZ",
  "America/Anchorage": "AK", "America/Juneau": "AK", "America/Sitka": "AK", "America/Nome": "AK", "America/Yakutat": "AK", "America/Metlakatla": "AK", "America/Adak": "AK",
  "Pacific/Honolulu": "HI", "America/Puerto_Rico": "PR",
};

export const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
/** Full names that are also common people's or places' names inside an org name; never read as the state. */
const AMBIGUOUS_NAMES = new Set(["GA", "VA", "WA", "NY", "IN"]);

function stateFromZone(zone: string | null | undefined): string | null {
  return zone ? ZONE_STATE[zone] ?? (zone.startsWith("America/Indiana/") ? "IN" : zone.startsWith("America/Kentucky/") ? "KY" : zone.startsWith("America/North_Dakota/") ? "ND" : null) : null;
}

function stateFromName(name: string | null | undefined): string | null {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const code = n.match(/(?:,\s*|\(|\s-\s)([A-Z]{2})\)?$/);
  if (code && STATE_NAMES[code[1]]) return code[1];
  // Longest names first, so "West Virginia" wins over "Virginia".
  const hits = Object.entries(STATE_NAMES)
    .filter(([c]) => !AMBIGUOUS_NAMES.has(c))
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, full]) => new RegExp(`\\b${full}\\b`).test(n));
  return hits.length === 1 ? hits[0][0] : null;
}

/** The organization's state from its own facts, or null (header). */
export function orgHomeState(facts: { timezone?: string | null; orgName?: string | null }): { state: string; from: "time zone" | "name" } | null {
  const z = stateFromZone(facts.timezone);
  if (z) return { state: z, from: "time zone" };
  const n = stateFromName(facts.orgName);
  if (n) return { state: n, from: "name" };
  return null;
}

/** The system prompt line. Empty when the organization has no state we can tell. */
export function orgHomeStatePrompt(home: ReturnType<typeof orgHomeState>): string {
  if (!home) return "\nYOUR ORGANIZATION'S STATE: not known. For a directory search with no state named, ask which state in one short question.";
  return `\nYOUR ORGANIZATION'S STATE: ${home.state} (${STATE_NAMES[home.state]}). When the staff member names a town or city with no state and has not used one earlier in this conversation, search ${home.state} and say so in one short clause ("in ${STATE_NAMES[home.state]}, your organization's state"). If they say they meant another state, search that one.`;
}

/** Best effort for the route: the profile read failing leaves the name, then nothing. */
export async function staffHomeStatePrompt(actor: Pick<OrgActor, "orgId" | "userId" | "role" | "orgName">, loadCore: () => Promise<{ getOrgProfile?: (a: Pick<OrgActor, "orgId" | "userId" | "role">) => Promise<{ timezone?: string | null; displayName?: string | null }> }> = () => import("@crucible/core")): Promise<string> {
  let timezone: string | null = null;
  let displayName: string | null = null;
  try {
    const core = await loadCore();
    const profile = core.getOrgProfile ? await core.getOrgProfile(actor) : null;
    timezone = profile?.timezone ?? null;
    displayName = profile?.displayName ?? null;
  } catch { /* the name alone, below */ }
  return orgHomeStatePrompt(orgHomeState({ timezone, orgName: displayName || actor.orgName }));
}
