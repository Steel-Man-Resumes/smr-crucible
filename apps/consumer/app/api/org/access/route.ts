/**
 * Setting the organization up: staff, roles, and what each person may do.
 *   GET   everyone on staff with their effective access
 *   POST  { action: "set_capability", userId, capability, on }
 *         { action: "invite_staff", name, email, role, title? }
 * The database re-derives who the actor is for every access change.
 */
import { NextResponse } from "next/server";
import { getOrgAccessOverview, setStaffCapability, inviteOrgStaff, DELEGABLE_CAPABILITIES } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { getOne } from "@crucible/core";
import { mintInviteMagicLink, buildStaffInviteEmail, sendOrgEmail } from "@/lib/org-invite-email";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const guard = await requireOrgCapability("org.staff.manage");
  if (!guard.ok) return guard.response;
  const members = await getOrgAccessOverview(guard.actor);
  if (!members) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({
    members,
    switches: DELEGABLE_CAPABILITIES,
    viewer: { userId: guard.actor.userId, role: guard.actor.role, orgName: guard.actor.orgName },
  });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.staff.manage");
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

  if (body.action === "invite_staff") {
    const res = await inviteOrgStaff(guard.actor, {
      name: String(body.name ?? ""), email: String(body.email ?? ""), role: String(body.role ?? "staff"),
      title: typeof body.title === "string" ? body.title : null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    // State first, email second: a failed send leaves a visible pending row
    // with a resend path, never an invisible half-made account.
    let emailed = true;
    try {
      const origin = new URL(request.url).origin;
      const inviter = await getOne<{ name: string | null }>(`SELECT name FROM users WHERE id = $1`, [guard.actor.userId]);
      const url = await mintInviteMagicLink(res.email, origin);
      await sendOrgEmail(res.email, buildStaffInviteEmail({
        inviteeName: res.name, inviterName: inviter?.name ?? null, orgName: guard.actor.orgName,
        roleLabel: body.role === "org_admin" ? "an admin" : "staff", url, origin,
      }));
    } catch (err) {
      emailed = false;
      console.error("staff invite email failed:", err);
    }
    return NextResponse.json({ ok: true, emailed });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
