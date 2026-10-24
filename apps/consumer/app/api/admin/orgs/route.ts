/**
 * Platform-admin organization setup.
 *
 * POST { action: "create", name, ownerEmail, ownerName?, seats }
 *      { action: "add_seats", orgId, seats }
 *      { action: "set_daily_limit", orgId, dailyLimit }
 *      { action: "rotate_code", orgId }
 *      { action: "set_owner", orgId, ownerEmail, ownerName? }
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
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
