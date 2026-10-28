/**
 * How this staff member likes to work.
 *   GET                                   effective, own, org defaults, and what the
 *                                         organization lets this role change (allowed, locked)
 *   PUT { own: {...} }                    replace my own choices ({} = use the org's). Refused
 *                                         (403, plain words) when it changes a choice the
 *                                         organization locks for my role (migration 108).
 *   PUT { orgDefaults: {...} }            managers only (org.settings.manage: owner, org admins)
 * Values are normalized against an allowlist in core; unknown keys are dropped.
 * One change at a time, logged and undoable: POST /api/org/prefs/view.
 */
import { NextResponse } from "next/server";
import { getStaffPrefs, setOwnStaffPrefs, setOrgStaffPrefDefaults, setQuietAfterDays } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  return NextResponse.json(await getStaffPrefs(guard.actor));
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (body.orgDefaults !== undefined) {
    const ok = await setOrgStaffPrefDefaults(guard.actor, body.orgDefaults);
    if (!ok) return NextResponse.json({ error: "Only someone who manages your organization's settings can set defaults." }, { status: 403 });
  }
  if (body.quietAfterDays !== undefined) {
    const ok = await setQuietAfterDays(guard.actor, Number(body.quietAfterDays));
    if (!ok) return NextResponse.json({ error: "Only someone who manages your organization's settings can change that, and it has to be between 3 and 90 days." }, { status: 400 });
  }
  if (body.own !== undefined) {
    const res = await setOwnStaffPrefs(guard.actor, body.own);
    if (!res.ok) return NextResponse.json({ error: res.error, locked: res.locked }, { status: 403 });
  }
  return NextResponse.json(await getStaffPrefs(guard.actor));
}
