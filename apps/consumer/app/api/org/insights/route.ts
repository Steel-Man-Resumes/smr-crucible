/**
 * GET: the organization's numbers. Requires `org.insights.view`.
 * GET ?format=csv: the same numbers as a spreadsheet, and ALSO requires `org.export`.
 *
 * The CSV carries, on every row, what the figure was counted over. A number that
 * leaves the building without its denominator gets quoted as something it is not.
 * It contains no names and no per-person rows. Its rows are built in
 * lib/org-insights-report.ts, the one definition the screen and print report share.
 */
import { getOrgOutboundBrand, withOutboundCsvHeader } from "@crucible/core/src/orgOutboundBrand";
import { NextResponse } from "next/server";
import { getOrgInsights, recordDataAccess } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { viewAsExportRefusal } from "@/lib/view-as";
import { insightsCsv } from "@/lib/org-insights-report";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.insights.view", { request });
  if (!guard.ok) return guard.response;
  const insights = await getOrgInsights(guard.actor);
  if (!insights) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });

  const format = new URL(request.url).searchParams.get("format");
  const exportRefused = viewAsExportRefusal(!!guard.viewing, format);
  if (exportRefused) return NextResponse.json({ error: exportRefused }, { status: 403 });
  if (format === "csv") {
    if (!guard.actor.capabilities.has("org.export")) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    await recordDataAccess({ accessorUserId: guard.actor.userId, resource: "org_insights", action: "export", context: { orgId: guard.actor.orgId } });
    const brand = await getOrgOutboundBrand(guard.actor.userId, guard.actor.orgId, guard.actor.orgName);
    return new NextResponse(withOutboundCsvHeader(insightsCsv(guard.actor.orgName, insights), brand, "Insights", new Date().toISOString().slice(0, 10)), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="insights-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  }
  // orgId is the caller's own organization (for its mark on the report), nothing more.
  return NextResponse.json({ insights, orgName: guard.actor.orgName, orgId: guard.actor.orgId, canExport: !guard.viewing && guard.actor.capabilities.has("org.export") });
}
