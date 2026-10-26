/**
 * One person's timeline: GET ?types=note,task,...&cursor=. The organization's
 * own records only (orgTimeline.ts), reach-checked in core and in the database.
 * Out of reach, another org, or no such person: one indistinct 404.
 */
import { NextResponse } from "next/server";
import { getPersonTimeline, parseTimelineTypes } from "@crucible/core";
import { crmGate, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await crmGate();
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const u = new URL(request.url);
  const res = await getPersonTimeline(g.actor, id, { types: parseTimelineTypes(u.searchParams.get("types")), cursor: u.searchParams.get("cursor") });
  if (!res.ok) return NextResponse.json({ error: "Not found." }, { status: res.reason === "not_in_reach_or_not_member" ? 404 : 403 });
  return NextResponse.json({ items: res.items, next: res.next, types: res.types });
}
