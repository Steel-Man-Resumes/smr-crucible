/**
 * The organization's own state, for staff t.ROY's directory searches (demo
 * fix T2, 2026-10-28).
 *
 * THE GAP. "Find employers in Jackson that hire people with records" got
 * "Which state is Jackson in?" from a Michigan organization. find_employers
 * needs a two-letter state, and nothing told t.ROY where the organization is.
 *
 * WHERE THE STATE COMES FROM. There is no state or address column for an
 * organization (org_profile has a time zone, migration 103). So only
 * org_profile.timezone, and only when the zone belongs to exactly one state
 * (America/Detroit is Michigan; America/Chicago is many states, so no).
 * Never a participant. Never the org's name (round 2: "Kansas City" and
 * "Nevada County" misread). No state: t.ROY asks, as before.
 */
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

/** Zones used by one state only. Multi-state zones (New_York, Chicago, Denver, Los_Angeles) are left out on purpose. */
const ZONE_STATE: Readonly<Record<string, string>> = {
  "America/Detroit": "MI", "America/Menominee": "MI",
  "America/Phoenix": "AZ",
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
function stateFromZone(zone: string | null | undefined): string | null {
  return zone ? ZONE_STATE[zone] ?? (zone.startsWith("America/Indiana/") ? "IN" : zone.startsWith("America/Kentucky/") ? "KY" : zone.startsWith("America/North_Dakota/") ? "ND" : null) : null;
}

/** The organization's state from its own facts, or null (header). */
export function orgHomeState(facts: { timezone?: string | null }): { state: string; from: "time zone" } | null {
  const z = stateFromZone(facts.timezone);
  return z ? { state: z, from: "time zone" } : null;
}

/** The system prompt line. Empty when the organization has no state we can tell. */
export function orgHomeStatePrompt(home: ReturnType<typeof orgHomeState>): string {
  if (!home) return "\nYOUR ORGANIZATION'S STATE: not known. For a directory search with no state named, ask which state in one short question.";
  return `\nYOUR ORGANIZATION'S STATE: ${home.state} (${STATE_NAMES[home.state]}). When the staff member names a town or city with no state and has not used one earlier in this conversation, search ${home.state} and say so in one short clause ("in ${STATE_NAMES[home.state]}, your organization's state"). If they say they meant another state, search that one.`;
}

/** Best effort for the route: a failed profile read means no state, and t.ROY asks. */
export async function staffHomeStatePrompt(actor: Pick<OrgActor, "orgId" | "userId" | "role">, loadCore: () => Promise<{ getOrgProfile?: (a: Pick<OrgActor, "orgId" | "userId" | "role">) => Promise<{ timezone?: string | null }> }> = () => import("@crucible/core")): Promise<string> {
  let timezone: string | null = null;
  try {
    const core = await loadCore();
    const profile = core.getOrgProfile ? await core.getOrgProfile(actor) : null;
    timezone = profile?.timezone ?? null;
  } catch { /* no state */ }
  return orgHomeStatePrompt(orgHomeState({ timezone }));
}
