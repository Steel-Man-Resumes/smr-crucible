/**
 * HUD Housing Counselor API Proxy
 *
 * Proxies the public HUD Housing Counselor API.
 * No API key required — HUD exposes this freely.
 * Returns structured list of housing counseling agencies near a location.
 */

import { NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/tenant-config";

export const maxDuration = 15;

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

interface CounselorResult {
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  services: string[];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get("location");
  const geo = getTenantConfig().geo;
  const searchLocation = location || geo.primaryLocations[0];

  try {
    const url = new URL(
      "https://data.hud.gov/Housing_Counselor/searchByLocation"
    );
    url.searchParams.set("Location", searchLocation);
    url.searchParams.set("Distance", String(geo.searchRadiusMiles));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`HUD API error: ${res.status}`);
      return NextResponse.json({ counselors: [] });
    }

    const data: HUDCounselor[] = await res.json();

    const counselors: CounselorResult[] = data.slice(0, 10).map((c) => ({
      name: c.nme?.trim() || "Housing Counselor",
      address: [c.adr1, c.adr2].filter(Boolean).join(", ").trim(),
      city: c.city?.trim() || "",
      state: c.statecd?.trim() || "",
      phone: c.phone1?.trim() || "",
      services: (c.services || []).slice(0, 5),
    }));

    return NextResponse.json({ counselors });
  } catch (error) {
    console.error("HUD API proxy error:", error);
    return NextResponse.json({ counselors: [] });
  }
}
