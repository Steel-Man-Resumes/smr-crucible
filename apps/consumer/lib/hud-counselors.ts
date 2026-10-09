/**
 * HUD housing counselors near a place: the public HUD Housing Counselor API
 * (no key). Called as a function by /api/resources/hud-counselors and by the
 * housing search (security review 3a Part 2 r1, L5): no server fetch to its
 * own URL, and no URL built from the request's Host header. The only host
 * reached is data.hud.gov.
 */

import { getTenantConfig } from "@/lib/tenant-config";

interface HUDCounselor {
  nme: string;         // Organization name
  adr1: string;        // Address line 1
  adr2: string;        // Address line 2
  city: string;
  statecd: string;
  zipcd: string;
  phone1: string;
  email: string;
  weburl: string;
  services: string[];  // Array of service descriptions
  languages: string[];
}

export interface CounselorResult {
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  services: string[];
}

export const HUD_SEARCH_URL = "https://data.hud.gov/Housing_Counselor/searchByLocation";

export async function findHudCounselors(
  location: string | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<CounselorResult[]> {
  const geo = getTenantConfig().geo;
  const searchLocation = (typeof location === "string" ? location.trim().slice(0, 120) : "") || geo.primaryLocations[0];
  try {
    const url = new URL(HUD_SEARCH_URL);
    url.searchParams.set("Location", searchLocation);
    url.searchParams.set("Distance", String(geo.searchRadiusMiles));
    const res = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.error(`HUD API error: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as HUDCounselor[];
    if (!Array.isArray(data)) return [];
    return data.slice(0, 10).map((c) => ({
      name: c.nme?.trim() || "Housing Counselor",
      address: [c.adr1, c.adr2].filter(Boolean).join(", ").trim(),
      city: c.city?.trim() || "",
      state: c.statecd?.trim() || "",
      phone: c.phone1?.trim() || "",
      services: (c.services || []).slice(0, 5),
    }));
  } catch (error) {
    console.error("HUD API error:", (error as { name?: string })?.name || "error");
    return [];
  }
}
