/**
 * Platform-admin organization setup.
 *
 * POST { action: "create", name, ownerEmail, ownerName?, seats }
 *      { action: "add_seats", orgId, seats }
 *      { action: "set_daily_limit", orgId, dailyLimit }
 *      { action: "rotate_code", orgId }
 *      { action: "set_owner", orgId, ownerEmail, ownerName? }
 *      { action: "set_staff_cap", orgId, maxStaff }
 *      { action: "set_staff_role", orgId, userId, role }   (support path: owner-only rule widened to platform admins)
 *      { action: "remove_staff", orgId, userId }
 * GET  ?orgId=  -> { staff } for the support panel (names, roles, titles)
 *
 * Platform admins only, with a second-factor session (requirePlatformAdmin).
 * The writes and their audit live in packages/core/src/orgAdmin.ts. A new
 * owner address gets the same sign-in link email a staff invite gets; the
 * state is written first, so a failed email still leaves a visible owner and
 * a way to sign in by email link.
 */
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import {
  getOne,
  validateCreateOrgInput,
  createOrganization,
  addOrgSeats,
  setOrgDailyLimit,
  rotateOrgCode,
  setOrgOwner,
  setOrgStaffCap,
  setOrgStaffRole,
  removeOrgStaff,
  getOrgStaff,
} from "@crucible/core";
import { mintInviteMagicLink, buildStaffInviteEmail, sendOrgEmail } from "@/lib/org-invite-email";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function emailNewOwner(request: Request, actorUserId: string, email: string, name: string | null, orgName: string): Promise<boolean> {
  try {
    const origin = new URL(request.url).origin;
    const admin = await getOne<{ name: string | null }>(`SELECT name FROM users WHERE id = $1`, [actorUserId]);
    const url = await mintInviteMagicLink(email, origin);
    await sendOrgEmail(email, buildStaffInviteEmail({
      inviteeName: name, inviterName: admin?.name ?? null, orgName, roleLabel: "the owner", url, origin,
    }));
    return true;
  } catch (err) {
    console.error("new owner email failed:", (err as Error)?.message || err);
    return false;
  }
}

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  if (!UUID.test(orgId)) return NextResponse.json({ error: "Pick an organization." }, { status: 400 });
  const staff = await getOrgStaff(orgId);
  return NextResponse.json({ staff: staff.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, title: m.title })) });
}

export async function POST(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  if (action === "create") {
    const v = validateCreateOrgInput(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const res = await createOrganization(v.value, guard.userId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    const emailed = res.ownerCreated
      ? await emailNewOwner(request, guard.userId, v.value.ownerEmail, v.value.ownerName ?? null, v.value.name)
      : null;
    return NextResponse.json({
      ok: true,
      orgId: res.orgId,
      code: res.code,
      ownerCreated: res.ownerCreated,
      emailed,
      warning: res.warning ?? null,
    });
  }

  const orgId = String(body?.orgId ?? "");
  if (!UUID.test(orgId)) return NextResponse.json({ error: "Pick an organization." }, { status: 400 });

  if (action === "add_seats") {
    const res = await addOrgSeats(orgId, Number(body.seats), guard.userId);
    return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "set_daily_limit") {
    const res = await setOrgDailyLimit(orgId, Number(body.dailyLimit), guard.userId);
    return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "rotate_code") {
    const res = await rotateOrgCode(orgId, guard.userId);
    return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "set_owner") {
    const res = await setOrgOwner(orgId, String(body.ownerEmail ?? ""), typeof body.ownerName === "string" ? body.ownerName : null, guard.userId);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    let emailed: boolean | null = null;
    if (res.ownerCreated) {
      const org = await getOne<{ partner_name: string }>(`SELECT partner_name FROM access_code WHERE id = $1`, [orgId]);
      emailed = await emailNewOwner(request, guard.userId, String(body.ownerEmail).trim().toLowerCase(),
        typeof body.ownerName === "string" ? body.ownerName.trim() || null : null, org?.partner_name ?? "your organization");
    }
    return NextResponse.json({ ok: true, ownerCreated: res.ownerCreated, emailed, warning: res.warning ?? null });
  }
  if (action === "set_staff_cap") {
    const res = await setOrgStaffCap(orgId, Number(body.maxStaff), guard.userId);
    return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  // Support path for a locked-out organization (review N4): the same staff
  // writes the owner makes, allowed here for a platform admin, read from the
  // platform_admin table inside each statement. The org console stays
  // owner-only. The org_staff audit trigger records this admin as the actor.
  if (action === "set_staff_role" || action === "remove_staff") {
    const userId = String(body.userId ?? "");
    if (!UUID.test(userId)) return NextResponse.json({ error: "Pick a staff member." }, { status: 400 });
    const res = action === "set_staff_role"
      ? await setOrgStaffRole({ orgId, userId, role: body.role === "org_admin" ? "org_admin" : "staff", actorUserId: guard.userId, authority: "owner_or_platform_admin" })
      : await removeOrgStaff({ orgId, userId, actorUserId: guard.userId, authority: "owner_or_platform_admin" });
    return res.ok ? NextResponse.json({ ...res, ok: true }) : NextResponse.json({ error: res.reason }, { status: 403 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
