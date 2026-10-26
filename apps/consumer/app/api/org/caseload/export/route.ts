/**
 * The caseload as a CSV, with the organization's custom fields.
 *   POST (form or JSON) sensitive=<field id>,<field id>   sensitive fields to include (ticked by the exporter)
 * POST, and only from this app's own pages (lib/same-origin: Sec-Fetch-Site
 * same-origin, or one of the app's own Origins): a download of people's
 * details is a deliberate act, never a link or a form on another site.
 * Needs org.export. Rows are the people the caller reaches who share
 * progress (the same consent-gated cohort as the table); values are read
 * through the reach-checked read. A sensitive field is left out unless it
 * was ticked by id, and what was included is written to the access log.
 */
import { NextResponse } from "next/server";
import {
  buildCaseloadCsv, getFieldValues, getOrgStaffDirectory, getPartnerCohort, listFieldDefs, recordDataAccess,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { isSameOriginRequest } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tickedIds(request: Request): Promise<string[]> {
  const type = request.headers.get("content-type") ?? "";
  let raw: unknown = "";
  if (type.includes("application/json")) raw = (await request.json().catch(() => ({})))?.sensitive ?? "";
  else raw = (await request.formData().catch(() => null))?.getAll("sensitive").join(",") ?? "";
  const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(",");
  return list.map((s) => s.trim()).filter((s) => UUID.test(s)).slice(0, 100);
}

export async function GET() {
  return NextResponse.json({ error: "Use the Export button on People." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.export", { request });
  if (!guard.ok) return guard.response;
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "Exports start from the People page." }, { status: 403 });
  const actor = guard.actor;
  if (actor.viaPlatformAdmin) return NextResponse.json({ error: "Exports are for the organization's own staff." }, { status: 403 });
  const ticked = await tickedIds(request);
  const seesAll = actor.capabilities.has("org.client.view_all");
  const [cohort, defs, values, staff] = await Promise.all([
    getPartnerCohort(actor.userId, { accessCodeId: actor.orgId, assignedToStaffId: seesAll ? undefined : actor.userId }),
    listFieldDefs(actor, { entity: "participant", includeRetired: true }),
    getFieldValues(actor, "participant"),
    getOrgStaffDirectory(actor),
  ]);
  const { csv, fields, sensitiveIncluded } = buildCaseloadCsv(cohort.clients, defs, values, {
    includeSensitiveIds: ticked, staffNames: new Map(staff.map((s) => [s.id, s.name])),
  });
  await recordDataAccess({
    accessorUserId: actor.userId,
    resource: "org_caseload",
    action: "export_csv",
    context: { orgId: actor.orgId, clientCount: cohort.clients.length, customFields: fields.length, sensitiveFields: sensitiveIncluded },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="caseload-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
