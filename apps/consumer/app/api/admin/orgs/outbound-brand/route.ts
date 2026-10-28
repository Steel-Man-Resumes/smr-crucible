/**
 * Platform admin: an organization's outbound branding (migration 107).
 *   GET  ?orgId=            -> { branding, brand }
 *   POST { orgId, branding } (co_brand | exclusive)
 * Platform admins only, with a second-factor session (requirePlatformAdmin);
 * the database refuses everyone else as well. Logic and tests: lib/outbound-brand-http.ts.
 */
import { requirePlatformAdmin } from "@/lib/org-guard";
import { getOrgOutboundBrand, setOrgOutboundBranding } from "@crucible/core/src/orgOutboundBrand";
import { handleAdminOutboundBrandGet, handleAdminOutboundBrandPost } from "@/lib/outbound-brand-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  return handleAdminOutboundBrandGet(guard.userId, new URL(request.url), { getOrgOutboundBrand });
}

export async function POST(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  return handleAdminOutboundBrandPost(guard.userId, request, { getOrgOutboundBrand, setOrgOutboundBranding });
}
