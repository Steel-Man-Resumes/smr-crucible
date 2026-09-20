/**
 * How this staff member likes to work.
 *   GET                                   effective, own, org defaults
 *   PUT { own: {...} }                    replace my own choices ({} = use the org's)
 *   PUT { orgDefaults: {...} }            owner only
 * Values are normalized against an allowlist in core; unknown keys are dropped.
 */
import { NextResponse } from "next/server";
import { getStaffPrefs, setOwnStaffPrefs, setOrgStaffPrefDefaults } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  return NextResponse.json(await getStaffPrefs(guard.actor));
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (body.orgDefaults !== undefined) {
    const ok = await setOrgStaffPrefDefaults(guard.actor, body.orgDefaults);
    if (!ok) return NextResponse.json({ error: "Only the organization's owner can set defaults." }, { status: 403 });
  }
  if (body.own !== undefined) await setOwnStaffPrefs(guard.actor, body.own);
  return NextResponse.json(await getStaffPrefs(guard.actor));
}
