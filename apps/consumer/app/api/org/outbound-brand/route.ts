/**
 * GET /api/org/outbound-brand: how the staff member's organization brands
 * what staff send out (migration 107). Logic and tests: lib/outbound-brand-http.ts.
 */
import { requireOrgCapability } from "@/lib/org-guard";
import { getOrgOutboundBrand } from "@crucible/core/src/orgOutboundBrand";
import { handleOutboundBrandGet } from "@/lib/outbound-brand-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  return handleOutboundBrandGet(guard.actor, { getOrgOutboundBrand });
}
