/**
 * One person's timeline: GET ?types=note,task,...&cursor=. The organization's
 * own records only (orgTimeline.ts), reach-checked in core and in the database.
 * Out of reach, another org, or no such person: one indistinct 404.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { getPersonTimeline, parseTimelineTypes } from "@crucible/core";
import { withCrm, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

/** The org guard, given this request (view-as aware: L2), then the staff workspace check. */
async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await gate(request);
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const u = new URL(request.url);
  const res = await getPersonTimeline(g.actor, id, { types: parseTimelineTypes(u.searchParams.get("types")), cursor: u.searchParams.get("cursor") });
  if (!res.ok) return NextResponse.json({ error: "Not found." }, { status: res.reason === "not_in_reach_or_not_member" ? 404 : 403 });
  return NextResponse.json({ items: res.items, next: res.next, types: res.types });
}
