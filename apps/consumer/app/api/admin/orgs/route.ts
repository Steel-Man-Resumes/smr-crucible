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
 *      { action: "set_brand_tier", orgId, tier }          (standard | cobrand | full; tier is what is sold, so admin only)
 *      { action: "rename", orgId, name }
 *      { action: "close", orgId, reason }                  (migration 100: closed_at, closed_by, close_reason)
 *      { action: "reopen", orgId }
 *      { action: "delete", orgId, confirmName }            (only an org with no history; the database checks again)
 *      { action: "add_staff", orgId, email, name, role, title? }  (existing account: added now; new address: invited)
 *      { action: "resend_invite" | "revoke_invite", orgId, inviteId }
 * GET  ?orgId=  -> { org, staff, invites, history, historyWords } for the Manage panel
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
  setOrgBrandTier,
  isOrgBrandTier,
} from "@crucible/core";
import {
  renameOrganization,
  closeOrganization,
  reopenOrganization,
  deleteEmptyOrganization,
  getOrgHistory,
  describeOrgHistory,
  adminAddStaff,
  listStaffInvites,
  prepareStaffInviteResend,
  revokeStaffInvite,
  isUndeliverableEmail,
  UNDELIVERABLE_LINE,
  CLOSED_MEANS,
  DELETE_MEANS,
  type OrgScope,
} from "@crucible/core";
import { mintInviteMagicLink, buildStaffInviteEmail, sendOrgEmail } from "@/lib/org-invite-email";
import { sendStaffInviteEmail, staffInviteSendMessage } from "@/lib/staff-invite-send";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function emailNewOwner(request: Request, actorUserId: string, email: string, name: string | null, orgName: string): Promise<boolean | "undeliverable"> {
  if (isUndeliverableEmail(email)) return "undeliverable";
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

/** The scope a platform admin reads and writes one organization under (as runPerOrg does). */
const adminScope = (orgId: string, userId: string): OrgScope => ({ orgId, userId, role: "org_admin" });

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  if (!UUID.test(orgId)) return NextResponse.json({ error: "Pick an organization." }, { status: 400 });
  const org = await getOne<{ id: string; partner_name: string; is_active: boolean; closed_at: string | null; close_reason: string | null;
    owner_email: string | null; owner_name: string | null; owner_tier: string | null; max_staff: number | null }>(
    `SELECT ac.id, ac.partner_name, ac.is_active, ac.closed_at, ac.close_reason, ac.max_staff,
            u.email AS owner_email, u.name AS owner_name, u.tier AS owner_tier
       FROM access_code ac LEFT JOIN users u ON u.id = ac.partner_user_id WHERE ac.id = $1`,
    [orgId]
  );
  if (!org) return NextResponse.json({ error: "That organization was not found." }, { status: 404 });
  const [staff, invites, history] = await Promise.all([
    getOrgStaff(orgId),
    listStaffInvites(adminScope(orgId, guard.userId)).catch((err) => { console.error("admin invite list failed:", (err as Error)?.message || err); return null; }),
    getOrgHistory(orgId, guard.userId).catch(() => null),
  ]);
  return NextResponse.json({
    org: {
      id: org.id, name: org.partner_name, isActive: org.is_active, closedAt: org.closed_at, closeReason: org.close_reason,
      ownerEmail: org.owner_email, ownerName: org.owner_name, ownerIsJobSeeker: org.owner_tier === "client", maxStaff: org.max_staff,
    },
    staff: staff.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, title: m.title })),
    invites,
    history,
    historyWords: history ? describeOrgHistory(history) : null,
    canDelete: !!history && Object.keys(history).length === 0,
    closedMeans: CLOSED_MEANS,
    deleteMeans: DELETE_MEANS,
  });
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
    // What was made, read back from the database, so the screen shows the
    // truth right after: the owner, and the staff and invitations (none yet).
    const owner = await getOne<{ email: string; name: string | null; tier: string }>(
      `SELECT email, name, tier FROM users WHERE id = $1`, [res.ownerUserId]);
    return NextResponse.json({
      ok: true,
      orgId: res.orgId,
      code: res.code,
      ownerCreated: res.ownerCreated,
      emailed: emailed === "undeliverable" ? false : emailed,
      undeliverable: emailed === "undeliverable",
      warning: res.warning ?? null,
      created: {
        owner: { email: owner?.email ?? v.value.ownerEmail, name: owner?.name ?? null, newAccount: res.ownerCreated, ownerIsJobSeeker: owner?.tier === "client" },
        staff: (await getOrgStaff(res.orgId)).map((m) => ({ name: m.name, email: m.email, role: m.role })),
        invites: (await listStaffInvites(adminScope(res.orgId, guard.userId)).catch(() => [])).map((i) => ({ email: i.email, status: i.statusWords })),
      },
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
      const sent = await emailNewOwner(request, guard.userId, String(body.ownerEmail).trim().toLowerCase(),
        typeof body.ownerName === "string" ? body.ownerName.trim() || null : null, org?.partner_name ?? "your organization");
      if (sent === "undeliverable") {
        return NextResponse.json({ ok: true, ownerCreated: true, emailed: false, undeliverable: true, warning: res.warning ?? null });
      }
      emailed = sent;
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
  // Branding tier (migration 099). The org_brand guard trigger also checks the
  // platform_admin table, so the database refuses this for anyone else.
  if (action === "set_brand_tier") {
    if (!isOrgBrandTier(body.tier)) return NextResponse.json({ error: "Pick standard, cobrand or full." }, { status: 400 });
    const res = await setOrgBrandTier(guard.userId, orgId, body.tier);
    if (res.ok) return NextResponse.json({ ok: true, tier: body.tier });
    const error = res.reason === "not_migrated" ? "Branding is not switched on yet (migration 099)." : "The branding tier did not save.";
    return NextResponse.json({ error }, { status: res.reason === "not_migrated" ? 503 : 403 });
  }
  // Lifecycle (migration 100). Every write answers with what happened.
  if (action === "rename") {
    const res = await renameOrganization(orgId, body.name, guard.userId);
    return res.ok ? NextResponse.json({ ok: true, name: res.name }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "close") {
    const res = await closeOrganization(orgId, body.reason, guard.userId);
    return res.ok ? NextResponse.json({ ok: true, closedAt: res.closedAt }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "reopen") {
    const res = await reopenOrganization(orgId, guard.userId);
    return res.ok ? NextResponse.json({ ok: true, warning: res.warning ?? null }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (action === "delete") {
    const res = await deleteEmptyOrganization(orgId, body.confirmName, guard.userId);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  // Staff, from Admin > Organizations: an existing account is added now; a
  // new address is invited with a sign-in link. Either way the screen says
  // what happened, including when nothing was saved.
  if (action === "add_staff") {
    const res = await adminAddStaff(orgId, guard.userId, { name: body.name, email: body.email, role: body.role, title: body.title });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    const org = await getOne<{ partner_name: string }>(`SELECT partner_name FROM access_code WHERE id = $1`, [orgId]);
    const origin = new URL(request.url).origin;
    const sent = await sendStaffInviteEmail({
      scope: adminScope(orgId, guard.userId), origin, orgName: org?.partner_name ?? "your organization", inviterUserId: guard.userId,
      send: { inviteId: res.inviteId, userId: res.userId, email: res.email, name: res.name, role: body.role === "org_admin" ? "org_admin" : "staff", volunteer: false, path: res.path, undeliverable: res.undeliverable },
    });
    const what = res.path === "admin_added"
      ? `${res.email} already had an account and is now on the team.`
      : `${res.email} was invited. They join the team when they sign in and say yes, within 14 days.`;
    const mail = sent === "emailed" ? (res.path === "admin_added" ? " A short notice was emailed." : " The invitation was emailed.")
      : sent === "undeliverable" ? ` ${UNDELIVERABLE_LINE}`
      : " The email did not send; use Resend below.";
    return NextResponse.json({ ok: true, path: res.path, result: sent, message: what + mail });
  }
  if (action === "resend_invite" || action === "revoke_invite") {
    const inviteId = String(body.inviteId ?? "");
    if (!UUID.test(inviteId)) return NextResponse.json({ error: "That invitation was not found." }, { status: 404 });
    const scope = adminScope(orgId, guard.userId);
    if (action === "revoke_invite") {
      // platformAdmin: true. requirePlatformAdmin above checked the second factor.
      const res = await revokeStaffInvite(scope, inviteId, { platformAdmin: true });
      return res.ok ? NextResponse.json({ ok: true, message: "Invitation revoked." }) : NextResponse.json({ error: res.error }, { status: 400 });
    }
    const prep = await prepareStaffInviteResend(scope, inviteId, { platformAdmin: true });
    if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: 400 });
    const org = await getOne<{ partner_name: string }>(`SELECT partner_name FROM access_code WHERE id = $1`, [orgId]);
    const origin = new URL(request.url).origin;
    const sent = await sendStaffInviteEmail({ scope, send: prep.send, origin, orgName: org?.partner_name ?? "your organization", inviterUserId: guard.userId });
    const message = (prep.restamped ? "The person who first sent this can no longer add staff, so you are now its sender. " : "") + staffInviteSendMessage(sent, prep.send.email, origin);
    return sent === "failed" ? NextResponse.json({ error: message }, { status: 502 }) : NextResponse.json({ ok: true, result: sent, message });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
