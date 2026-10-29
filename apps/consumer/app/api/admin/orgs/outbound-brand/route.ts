/**
 * Platform admin: an organization's outbound branding (migration 107).
 *   GET  ?orgId=            -> { branding, brand }
 *   POST { orgId, branding } (co_brand | exclusive)
 * Platform admins only, with a second-factor session (requirePlatformAdmin);
 * the database refuses everyone else as well. Logic and tests: lib/outbound-brand-http.ts.
 */
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";
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
  // Same-origin JSON first, before the session is read (final review should-fix 1).
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  return handleAdminOutboundBrandPost(guard.userId, request, { getOrgOutboundBrand, setOrgOutboundBranding });
}
