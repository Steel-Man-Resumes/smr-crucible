/** GET: the organization's numbers. Requires `org.insights.view`. */
import { NextResponse } from "next/server";
import { getOrgInsights } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.insights.view");
  if (!guard.ok) return guard.response;
  const insights = await getOrgInsights(guard.actor);
  if (!insights) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ insights, orgName: guard.actor.orgName });
}
