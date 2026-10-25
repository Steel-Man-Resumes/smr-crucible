/**
 * The organization's logo, managed by its owner (C3 brand, migration 099).
 *
 *   GET    -> { orgId, name, brand: { hasLogo, tier }, canManage }   any staff member
 *   POST   multipart "file" -> sets the logo                         owner only
 *   DELETE -> removes the logo (the branding tier stays)              owner only
 *
 * Owner only means `org.settings.manage`, which only the owner's role bundle
 * carries and which is not delegable, and never a platform admin acting for
 * an organization. The database refuses anyone else too (the 099 guard checks
 * access_code.partner_user_id), so this check is the friendly answer and the
 * table is the control.
 *
 * The logic lives in lib/org-brand-http.ts (tested there). The body is read
 * with a byte cap: no Content-Length is 411, over the cap is 413, and bytes
 * are counted as they stream. The file is checked server side, whatever the browser said: PNG, JPEG
 * or WebP by its bytes, never SVG, 512 KB at most, 2048 px a side at most.
 * Every set and removal lands in org_audit through the table's trigger.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { getOrgBrand, removeOrgLogo, setOrgLogo, DEFAULT_ORG_BRAND } from "@crucible/core";
import { handleLogoRemove, handleLogoUpload } from "@/lib/org-brand-http";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const guard = await requireOrgCapability("org.staff.view");
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  const brand = await getOrgBrand(actor.userId, actor.orgId).catch(() => ({ ...DEFAULT_ORG_BRAND }));
  return NextResponse.json(
    {
      orgId: actor.orgId,
      name: actor.orgName,
      brand,
      canManage: actor.capabilities.has("org.settings.manage") && !actor.viaPlatformAdmin,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard.response;
  return handleLogoUpload(request, guard.actor, { setOrgLogo, getOrgBrand });
}

export async function DELETE() {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard.response;
  return handleLogoRemove(guard.actor, { removeOrgLogo, getOrgBrand });
}
