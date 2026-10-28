/**
 * Connections one person missed (staff pass S5): employers with the hiring
 * mark and job help that fit what they SHARED, each with its reason. GET only.
 * Reading their shared jobs and resumes for this is logged for them, in the
 * same transaction (orgClientView.getConnectionInputs). Out of reach, another
 * org, or no such person: one indistinct 404.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { getConnectionsFor, getClientHeader } from "@crucible/core";
import { withCrm, refuseCrossSiteRead, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  // This read writes access-log lines: never on another site's behalf.
  const crossSite = refuseCrossSiteRead(request);
  if (crossSite) return crossSite;
  const { id } = await props.params;
  const g = await withCrm(await requireOrgCapability("org.client.view_content", { request }));
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // The name by consent, the same as the page header (no content read, no log).
  const header = await getClientHeader(g.actor, id);
  if (!header.ok) return NextResponse.json({ error: "Not found." }, { status: header.reason === "not_in_reach_or_not_member" ? 404 : 403 });
  const res = await getConnectionsFor(g.actor, id, header.rows[0]?.name ?? null);
  if (!res || res.status === "not_in_reach") return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ connections: res });
}
