/**
 * Outbound branding over HTTP (migration 107, staff pass 2026-10-27 lane S2).
 * The route logic, with its database calls passed in, so the rules are unit
 * tested without a database.
 *
 *   GET  /api/org/outbound-brand                    anyone on staff (org.cohort.view): how what they
 *                                                   send out is branded. Read only; view-as may read.
 *   GET  /api/admin/orgs/outbound-brand?orgId=      platform admin: the current setting.
 *   POST /api/admin/orgs/outbound-brand {orgId, branding}
 *                                                   platform admin only (the database refuses anyone
 *                                                   else too: smr_set_org_branding and its guard).
 *
 * Never a price, in any answer.
 */
import { NextResponse } from "next/server";
import { isOrgBranding, type OrgBranding, type OutboundBrand } from "@crucible/core/src/orgOutboundBrandShared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "cache-control": "no-store" };

export interface OutboundBrandDeps {
  getOrgOutboundBrand: (userId: string, orgId: string, fallbackName?: string | null) => Promise<OutboundBrand>;
}
export interface OutboundBrandSetDeps extends OutboundBrandDeps {
  setOrgOutboundBranding: (adminUserId: string, orgId: string, branding: unknown) => Promise<{ ok: true; branding: OrgBranding } | { ok: false; reason: string }>;
}

/** The staff member's own organization: the guard decided which one; the request cannot name another. */
export async function handleOutboundBrandGet(actor: { userId: string; orgId: string; orgName: string }, deps: OutboundBrandDeps): Promise<NextResponse> {
  const brand = await deps.getOrgOutboundBrand(actor.userId, actor.orgId, actor.orgName);
  return NextResponse.json({ brand }, { headers: noStore });
}

export async function handleAdminOutboundBrandGet(adminUserId: string, url: URL, deps: OutboundBrandDeps): Promise<NextResponse> {
  const orgId = url.searchParams.get("orgId") ?? "";
  if (!UUID.test(orgId)) return NextResponse.json({ error: "Pick an organization." }, { status: 400 });
  const brand = await deps.getOrgOutboundBrand(adminUserId, orgId, url.searchParams.get("name"));
  return NextResponse.json({ branding: brand.branding, brand }, { headers: noStore });
}

export const ADMIN_BRANDING_WORDS: Record<string, string> = {
  bad_value: "Pick co-branded or the organization's own name only.",
  not_admin: "Only a platform admin can change this.",
  not_migrated: "Outbound branding is not switched on yet (migration 107).",
  failed: "The branding did not save.",
};

export async function handleAdminOutboundBrandPost(adminUserId: string, request: Request, deps: OutboundBrandSetDeps): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as { orgId?: unknown; branding?: unknown } | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (!UUID.test(orgId)) return NextResponse.json({ error: "Pick an organization." }, { status: 400 });
  if (!isOrgBranding(body?.branding)) return NextResponse.json({ error: ADMIN_BRANDING_WORDS.bad_value }, { status: 400 });
  const res = await deps.setOrgOutboundBranding(adminUserId, orgId, body!.branding);
  if (res.ok) return NextResponse.json({ ok: true, branding: res.branding }, { headers: noStore });
  const status = res.reason === "not_migrated" ? 503 : res.reason === "not_admin" ? 403 : res.reason === "bad_value" ? 400 : 500;
  return NextResponse.json({ error: ADMIN_BRANDING_WORDS[res.reason] ?? ADMIN_BRANDING_WORDS.failed }, { status });
}
