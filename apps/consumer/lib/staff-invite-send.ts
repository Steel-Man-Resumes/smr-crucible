/**
 * Send (or resend) one staff invitation's email and record it (migration 100).
 *
 * Used by Team & access (/api/org/access) and Admin > Organizations
 * (/api/admin/orgs) so both send the same email the same way. The state is
 * written before this runs; the send is the last step, and its result is what
 * the screen reports, never a guess:
 *   emailed        the provider accepted it (Resend, same as every org email)
 *   undeliverable  a reserved test address (.invalid and friends): nothing was
 *                  sent, the screen says so and points at the sign-up link
 *   failed         the send threw: the screen says it did not send
 *
 * A new account gets a sign-in link that lives as long as the invitation
 * (14 days) and lands on /dashboard/invites to say yes or no. An existing
 * account gets the "sign in to answer" email. An account a platform admin
 * added directly gets a short notice.
 */
import {
  getOne,
  markStaffInviteSent,
  STAFF_INVITE_TTL_DAYS,
  type OrgScope,
  type StaffInviteSend,
} from "@crucible/core";
import {
  buildStaffAddedEmail,
  buildStaffInvitationEmail,
  buildStaffInviteEmail,
  mintInviteMagicLink,
  sendOrgEmail,
} from "@/lib/org-invite-email";

export type StaffInviteSendResult = "emailed" | "undeliverable" | "failed";

/** Plain role words for the email ("as a volunteer"). */
export function staffRoleLabel(role: "org_admin" | "staff", volunteer: boolean): string {
  if (role === "org_admin") return "an admin";
  return volunteer ? "a volunteer" : "staff";
}

export async function sendStaffInviteEmail(opts: {
  scope: OrgScope;
  send: StaffInviteSend;
  origin: string;
  orgName: string;
  /** The person inviting (their name goes in the email). */
  inviterUserId: string;
}): Promise<StaffInviteSendResult> {
  const { scope, send, origin, orgName } = opts;
  if (send.undeliverable) {
    // Renew the window so the person can still accept by signing in; count no send.
    await markStaffInviteSent(scope, send.inviteId, false).catch(() => false);
    return "undeliverable";
  }
  const roleLabel = staffRoleLabel(send.role, send.volunteer);
  try {
    const inviter = await getOne<{ name: string | null }>(`SELECT name FROM users WHERE id = $1`, [opts.inviterUserId]);
    if (send.path === "new_account") {
      // The link signs them in and lands on the answer page: nobody is on
      // staff until they say yes there (smr_answer_staff_invite).
      const url = await mintInviteMagicLink(send.email, origin, STAFF_INVITE_TTL_DAYS, "/dashboard/invites");
      await sendOrgEmail(send.email, buildStaffInviteEmail({
        inviteeName: send.name, inviterName: inviter?.name ?? null, orgName, roleLabel, url, origin, linkDays: STAFF_INVITE_TTL_DAYS, invitation: true,
      }));
    } else if (send.path === "existing_account") {
      await sendOrgEmail(send.email, buildStaffInvitationEmail({
        inviteeName: send.name, inviterName: inviter?.name ?? null, orgName, roleLabel, origin, days: STAFF_INVITE_TTL_DAYS,
      }));
    } else {
      await sendOrgEmail(send.email, buildStaffAddedEmail({ inviteeName: send.name, orgName, roleLabel, origin }));
    }
  } catch (err) {
    console.error("staff invite email failed:", (err as Error)?.message || err);
    return "failed";
  }
  await markStaffInviteSent(scope, send.inviteId, true).catch(() => false);
  return "emailed";
}

/** What the screen says after an invite or a resend, by result. Never claims a send that did not happen. */
export function staffInviteSendMessage(result: StaffInviteSendResult, email: string, origin: string): string {
  if (result === "emailed") return `Invitation sent to ${email}.`;
  if (result === "undeliverable") {
    return `Saved. This address cannot receive email, so nothing was sent. Share the sign-up link instead: they sign in at ${origin}/login and answer at ${origin}/dashboard/invites.`;
  }
  return `Saved, but the email did not send. Use Resend on the invitation list to try again.`;
}
