/**
 * Connections across the people this staff member reaches (staff pass S5).
 * GET only, on purpose behind a button: every person whose shared jobs or
 * resumes are read for it gets a line in their own access log.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { getCaseloadConnections } from "@crucible/core";
import { withCrm } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await withCrm(await requireOrgCapability("org.client.view_content", { request }));
  if (!g.ok) return g.response;
  const res = await getCaseloadConnections(g.actor);
  if (!res) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json(res);
}
