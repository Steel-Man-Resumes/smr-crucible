/**
 * The staff Directory search (lane S1, staff pass 2026-10-27).
 *   GET ?place=&need=&q=&sector=&show=all|help|employers
 *
 * Staff seats with org.client.view_content and the staff workspace on
 * (withCrm). PUBLIC DIRECTORY DATA ONLY: the staff member types the place
 * and what they are looking for; nothing about any participant is read.
 * Same readers and bands as the public site and staff t.ROY (find_local_help,
 * find_employers). At most 20 of each, no paging, no export; employer reads
 * count against the employer board's daily page allowance (team tier), so
 * this is not a way around it.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { withCrm } from "@/lib/org-crm-gate";
import { getClientIp } from "@/lib/auth-rate-limit";
import { EMPLOYER_PAGES_ENDPOINT, EMPLOYER_PAGES_LIMIT_MESSAGE, employerPageAllowed } from "@/lib/employer-paging";
import { parseDirectoryQuery, shapeResources, shapeEmployers, sectorsOf, DIRECTORY_WORDS } from "@/lib/staff-directory";
import { RESOURCE_AREAS } from "@crucible/core/src/resourceDirectoryShared";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const g = await withCrm(await requireOrgCapability("org.client.view_content", { request }));
  if (!g.ok) return g.response;
  const query = parseDirectoryQuery(new URL(request.url).searchParams);
  const { parsePlace } = await import("@/lib/support-location");
  const place = parsePlace(query.place);
  if (!place.state) return NextResponse.json({ status: "needs_place", error: DIRECTORY_WORDS.needsPlace }, { status: 400, headers: NO_STORE });
  const core = await import("@crucible/core");

  let help: ReturnType<typeof shapeResources> | null = null;
  let helpUnavailable = false;
  if (query.show !== "employers") {
    const counties = place.countyKeys.length ? place.countyKeys : (await import("@/lib/support-place-index")).countiesOf(place);
    const result = await core.searchVerifiedResources({
      state: place.state, areas: query.needs.length ? query.needs : [...RESOURCE_AREAS], countyKeys: counties, cityKey: place.cityKey, zip: place.zip, bands: ["A", "B", "C"],
    });
    if (result.status === "ok") help = shapeResources(result.data); else helpUnavailable = true;
  }

  let employers: ReturnType<typeof shapeEmployers> | null = null;
  let sectors: string[] = [];
  let employersUnavailable = false;
  let employersLimited = false;
  if (query.show !== "help") {
    const [account, network] = await Promise.all([
      core.incrementUserUsage(g.actor.userId, EMPLOYER_PAGES_ENDPOINT),
      core.incrementIpUsage(getClientIp(request), EMPLOYER_PAGES_ENDPOINT),
    ]);
    // The team allowance: the org guard proved a staff role (staff can hold
    // any account tier, L2), and staff look up for many people.
    if (!employerPageAllowed(account, network, "partner")) employersLimited = true;
    else {
      const result = await core.searchVerifiedEmployers({ state: place.state, q: query.q ?? undefined, industry: query.sector ?? undefined, bands: ["A", "B"], limit: 25 });
      if (result.status === "ok") { employers = shapeEmployers(result.data, { city: place.cityKey }); sectors = sectorsOf(result.data); }
      else employersUnavailable = true;
    }
  }

  return NextResponse.json({
    status: "ok", asOf: new Date().toISOString(),
    place: { state: place.state, city: place.cityKey ?? null, zip: place.zip ?? null },
    help, helpUnavailable, employers, employersUnavailable, sectors,
    employersLimited: employersLimited ? EMPLOYER_PAGES_LIMIT_MESSAGE : null,
    words: DIRECTORY_WORDS,
  }, { headers: NO_STORE });
}
