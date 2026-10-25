/**
 * GET /api/org/brand/{orgId}/logo -- an organization's logo, to the people
 * who belong to it.
 *
 * Who gets bytes is decided by the database: org_brand is row-level protected
 * and readLogo runs as the signed-in user, so the row is visible only to the
 * organization's owner, its staff, a member who joined with its code, or a
 * platform admin. Everyone else, and an organization with no logo, gets the
 * same 404, so the answer never says whether a stranger's organization has
 * one. The bytes were checked on upload (PNG, JPEG or WebP; never SVG) and are
 * served with nosniff and a sandboxing CSP all the same.
 *
 * effectiveAuth so a platform admin's view-as shows what that person sees;
 * impersonation is admin-only and a platform admin may read any logo anyway.
 */
import { effectiveAuth } from "@/lib/effective-auth";
import { readOrgLogo } from "@crucible/core";
import { handleLogoGet } from "@/lib/org-brand-http";

export const runtime = "nodejs";
export const maxDuration = 10;

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await effectiveAuth();
  const { orgId } = await context.params;
  return handleLogoGet(request, session?.user?.id, orgId, { readOrgLogo });
}
