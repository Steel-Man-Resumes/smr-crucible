/**
 * Setting the organization up: staff, roles, and what each person may do.
 *   GET   everyone on staff with their effective access, and the staff
 *         invitations with status, send count, last sent and expiry
 *   POST  { action: "set_capability", userId, capability, on }
 *         { action: "invite_staff", name, email, role, title? }
 *         { action: "resend_invite", inviteId }
 *         { action: "revoke_invite", inviteId }
 * The database re-derives who the actor is for every access change. Every
 * write answers with what actually happened, including "nothing was saved".
 */
import { NextResponse } from "next/server";
import {
  getOrgAccessOverview, setStaffCapability, inviteOrgStaff, applyStaffPreset, DELEGABLE_CAPABILITIES, STAFF_PRESETS,
  listStaffInvites, prepareStaffInviteResend, revokeStaffInvite, scopeOfActor, STAFF_INVITE_TTL_DAYS,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { sendStaffInviteEmail, staffInviteSendMessage } from "@/lib/staff-invite-send";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.staff.manage", { request });
  if (!guard.ok) return guard.response;
  const members = await getOrgAccessOverview(guard.actor);
  if (!members) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  const invites = await listStaffInvites(scopeOfActor(guard.actor)).catch((err) => {
    console.error("staff invite list failed:", (err as Error)?.message || err);
    return null;
  });
  return NextResponse.json({
    members,
    invites,
    inviteDays: STAFF_INVITE_TTL_DAYS,
    switches: DELEGABLE_CAPABILITIES,
    presets: Object.entries(STAFF_PRESETS).map(([id, p]) => ({ id, label: p.label, help: p.help })),
    viewer: { userId: guard.actor.userId, role: guard.actor.role, orgName: guard.actor.orgName },
  });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.staff.manage", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));

  if (body.action === "set_capability") {
    if (!UUID.test(String(body.userId ?? ""))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const members = await getOrgAccessOverview(guard.actor);
    const target = members?.find((m) => m.userId === body.userId);
    if (!target) return NextResponse.json({ error: "That person is not on your staff." }, { status: 404 });
    const res = await setStaffCapability(guard.actor, target.userId, String(body.capability ?? ""), body.on === true, target.role);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 403 });
  }

  if (body.action === "apply_preset") {
    if (!UUID.test(String(body.userId ?? ""))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const members = await getOrgAccessOverview(guard.actor);
    const target = members?.find((m) => m.userId === body.userId);
    if (!target) return NextResponse.json({ error: "That person is not on your staff." }, { status: 404 });
    const res = await applyStaffPreset(guard.actor, target.userId, String(body.preset ?? ""), target.role);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 403 });
  }

  if (body.action === "invite_staff") {
    const res = await inviteOrgStaff(guard.actor, {
      name: String(body.name ?? ""), email: String(body.email ?? ""), role: String(body.role ?? "staff"),
      title: typeof body.title === "string" ? body.title : null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    // State first, email second: a failed send leaves a visible invitation
    // with Resend, never an invisible half-made account. The answer is the
    // same for a new address and an existing account.
    const origin = new URL(request.url).origin;
    const sent = await sendStaffInviteEmail({
      scope: scopeOfActor(guard.actor), origin, orgName: guard.actor.orgName, inviterUserId: guard.actor.userId,
      send: { inviteId: res.inviteId, userId: res.userId, email: res.email, name: res.name, role: body.role === "org_admin" ? "org_admin" : "staff", volunteer: body.role === "volunteer", path: res.path, undeliverable: res.undeliverable },
    });
    return NextResponse.json({ ok: true, emailed: sent === "emailed", result: sent, message: staffInviteSendMessage(sent, res.email, origin) });
  }

  if (body.action === "resend_invite" || body.action === "revoke_invite") {
    // The organization's own owner and admins only; the platform-admin
    // support path is Admin > Organizations (/api/admin/orgs).
    if (guard.actor.viaPlatformAdmin) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    const inviteId = String(body.inviteId ?? "");
    if (!UUID.test(inviteId)) return NextResponse.json({ error: "That invitation was not found." }, { status: 404 });
    const scope = scopeOfActor(guard.actor);
    if (body.action === "revoke_invite") {
      // platformAdmin: false. This is the organization's own page; a platform
      // admin acting here is only its owner or admin (review should-fix 2).
      const res = await revokeStaffInvite(scope, inviteId, { platformAdmin: false });
      return res.ok ? NextResponse.json({ ok: true, message: "Invitation revoked. The link no longer opens your workspace." })
                    : NextResponse.json({ error: res.error }, { status: 400 });
    }
    const prep = await prepareStaffInviteResend(scope, inviteId, { platformAdmin: false });
    if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: 400 });
    const origin = new URL(request.url).origin;
    const sent = await sendStaffInviteEmail({ scope, send: prep.send, origin, orgName: guard.actor.orgName, inviterUserId: guard.actor.userId });
    const message = (prep.restamped ? "The person who first sent this can no longer add staff, so you are now its sender. " : "") + staffInviteSendMessage(sent, prep.send.email, origin);
    return sent === "failed" ? NextResponse.json({ error: message }, { status: 502 }) : NextResponse.json({ ok: true, result: sent, message });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
