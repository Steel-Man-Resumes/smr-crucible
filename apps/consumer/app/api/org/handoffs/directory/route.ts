/**
 * The directory, for picking something to send a person (staff pass S5).
 *   GET ?kind=employer&q=&state=     employers with the mark (A) or reported evidence (B)
 *   GET ?kind=resource&state=&area=&city=   places for help, checked first
 * The state is required for both, and only that state's listings come back
 * (national rows tagged to another state are dropped: inPickedState).
 * Public directory data only: this reads nothing about any person. Gated on
 * org.suggest.write because it exists to fill a handoff.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { searchVerifiedEmployers, searchVerifiedResources, foldCity } from "@crucible/core";
import { isResourceArea } from "@crucible/core/src/resourceDirectoryShared";
import { bandLine } from "@/lib/handoff-words";
import { withCrm } from "@/lib/org-crm-gate";
import { inPickedState } from "@/lib/staff-directory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await withCrm(await requireOrgCapability("org.suggest.write", { request }));
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const state = (u.searchParams.get("state") ?? "").trim().toUpperCase();
  const st = /^[A-Z]{2}$/.test(state) ? state : undefined;
  // Every search is one state's listings (the state typed in the picker): no state, no search.
  if (!st && (u.searchParams.get("kind") === "employer" || u.searchParams.get("kind") === "resource")) return NextResponse.json({ error: "Pick a state first." }, { status: 400 });
  if (u.searchParams.get("kind") === "employer") {
    const q = (u.searchParams.get("q") ?? "").trim().slice(0, 80);
    const r = await searchVerifiedEmployers({ q: q || undefined, state: st, bands: ["A", "B"], limit: 12 });
    if (r.status !== "ok") return NextResponse.json({ error: "The directory could not be read just now. Try again." }, { status: 503 });
    return NextResponse.json({
      results: inPickedState(r.data, st!).map((e) => ({
        kind: "employer", id: e.id, name: e.name, location: e.location ?? [e.city, e.state].filter(Boolean).join(", "), roleTypes: e.roleTypes,
        applyUrl: e.applyUrl, band: e.band, bandLine: bandLine("employer", e.band), checkedAt: e.checkedAt,
      })),
    });
  }
  if (u.searchParams.get("kind") === "resource") {
    const area = u.searchParams.get("area") ?? "jobs";
    const r = await searchVerifiedResources({ state: st!, areas: [isResourceArea(area) ? area : "jobs"], cityKey: foldCity(u.searchParams.get("city")), bands: ["A", "B", "C"], pageSize: 12 });
    if (r.status !== "ok") return NextResponse.json({ error: "The directory could not be read just now. Try again." }, { status: 503 });
    return NextResponse.json({
      results: inPickedState(r.data, st!).slice(0, 12).map((s) => ({
        kind: "resource", id: s.service_id, name: s.service_name ? `${s.service_name}, ${s.org_name}` : s.org_name, location: [s.city, s.state].filter(Boolean).join(", "),
        area: s.area_label, band: s.band, bandLine: bandLine("resource", s.band), checkedAt: s.last_checked,
      })),
    });
  }
  return NextResponse.json({ error: "Say what to look for." }, { status: 400 });
}
