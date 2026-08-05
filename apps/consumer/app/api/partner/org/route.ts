/**
 * Partner org API -- the staff-hierarchy layer over the consent-gated cohort.
 *
 * GET  -> { org, staff[], cohort, invites[] } scoped by the caller's role:
 *         owner/org_admin see the whole org (incl. per-client AI cost);
 *         staff see only their assigned clients (no cost column).
 * POST -> { action: "assign", clientUserId, staffUserId|null }  (admins only)
 *         { action: "invite", name, email }                     (admin + staff)
 *         { action: "resend_invite" | "revoke_invite", userId } (admin + staff)
 *
 * Invite flow (Troy 2026-08-05): pre-provision the account attributed to the
 * org (normal seat-aware redemption), email a 7-day magic-link welcome. A
 * staff inviter gets the new client auto-assigned to them. Existing
 * unaffiliated accounts are attached and notified; accounts bound to another
 * org are refused (first-code-wins isolation).
 *
 * Consent doctrine unchanged: progress signals only, never content; clients
 * who have not granted 'sharing' are counted but never named. Invite rows show
 * only what the admin themselves typed (name + email), no progress.
 */

import { NextResponse } from "next/server";
// effectiveAuth: impersonation-aware, so viewing Marianne shows HER org, not
// the admin's. Blue-view writes are still blocked at the middleware edge.
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getUserTier,
  getOrgContext,
  getOrgStaff,
  getPartnerCohort,
  assignClientStaff,
  getOrgPendingInvites,
  createOrgInvite,
  touchOrgInviteResend,
  revokeOrgInvite,
} from "@crucible/core";
import { isValidEmail } from "@/lib/auth-rate-limit";
import {
  mintInviteMagicLink,
  buildInviteEmail,
  buildAddedEmail,
  sendOrgEmail,
} from "@/lib/org-invite-email";

export const maxDuration = 15;

async function resolveContext(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return { error: 401 as const };
  const tier = await getUserTier(session.user.id);
  const { searchParams } = new URL(request.url);
  const overrideCodeId =
    tier === "admin" ? searchParams.get("codeId") || undefined : undefined;
  const org = await getOrgContext(session.user.id, {
    isAdmin: tier === "admin",
    overrideCodeId,
  });
  if (!org) return { error: 403 as const };
  return { org, userId: session.user.id, tier };
}

export async function GET(request: Request) {
  const ctx = await resolveContext(request);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "Not authenticated" : "No org access" },
      { status: ctx.error }
    );
  }
  const { org, userId } = ctx;
  const isOrgAdmin = org.role === "owner" || org.role === "org_admin";

  try {
    const [staff, cohort, invites] = await Promise.all([
      getOrgStaff(org.accessCodeId),
      getPartnerCohort(userId, {
        accessCodeId: org.accessCodeId,
        assignedToStaffId: isOrgAdmin ? undefined : userId,
      }),
      getOrgPendingInvites(org.accessCodeId),
    ]);

    // Staff never see the money column -- that is org-admin/owner information.
    const clients = isOrgAdmin
      ? cohort.clients
      : cohort.clients.map((c) => ({ ...c, aiCostUsd: 0 }));

    return NextResponse.json({
      org: {
        name: org.orgName,
        code: org.code,
        logoUrl: org.logoUrl,
        role: org.role,
      },
      staff,
      cohort: { ...cohort, clients },
      invites,
      canManage: isOrgAdmin,
      canInvite: true,
      showCosts: isOrgAdmin,
    });
  } catch (err: any) {
    console.error("partner org GET failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await resolveContext(request);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "Not authenticated" : "No org access" },
      { status: ctx.error }
    );
  }
  const { org, userId } = ctx;
  const isOrgAdmin = org.role === "owner" || org.role === "org_admin";
  const origin = new URL(request.url).origin;

  try {
    const body = await request.json();

    if (body.action === "assign") {
      if (!isOrgAdmin) {
        return NextResponse.json({ error: "Org admins only" }, { status: 403 });
      }
      if (!body.clientUserId) {
        return NextResponse.json({ error: "clientUserId required" }, { status: 400 });
      }
      await assignClientStaff(
        org.accessCodeId,
        body.clientUserId,
        body.staffUserId || null,
        userId
      );
      return NextResponse.json({ ok: true });
    }

    // Invite actions: open to org admins AND staff (Troy 2026-08-05).
    if (body.action === "invite") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").toLowerCase().trim();
      if (!name) {
        return NextResponse.json({ error: "Please enter their name." }, { status: 400 });
      }
      if (!isValidEmail(email)) {
        return NextResponse.json(
          { error: "Please enter a valid email address." },
          { status: 400 }
        );
      }
      const created = await createOrgInvite({
        accessCodeId: org.accessCodeId,
        code: org.code,
        name,
        email,
        invitedBy: userId,
      });
      if (!created.ok) {
        return NextResponse.json({ error: created.error }, { status: 400 });
      }

      // A staff inviter takes responsibility for their invitee automatically.
      if (org.role === "staff") {
        await assignClientStaff(org.accessCodeId, created.userId, userId, userId).catch(
          (err) => console.error("invite auto-assign failed:", err?.message || err)
        );
      }

      // State is committed; the email is the last step. If it fails, say so
      // plainly -- the pending panel's Resend button is the retry path.
      try {
        const inviterName = (await auth())?.user?.name || null;
        if (created.kind === "invited") {
          const url = await mintInviteMagicLink(email, origin);
          await sendOrgEmail(
            email,
            buildInviteEmail({ inviteeName: name, inviterName, orgName: org.orgName, url, origin })
          );
        } else {
          await sendOrgEmail(
            email,
            buildAddedEmail({ inviteeName: name, inviterName, orgName: org.orgName, origin })
          );
        }
      } catch (err: any) {
        console.error("invite email failed:", err?.message || err);
        return NextResponse.json({
          ok: true,
          kind: created.kind,
          message:
            "The seat is reserved, but the email could not be sent. Use Resend in the pending list, or check the address.",
          emailFailed: true,
        });
      }

      return NextResponse.json({
        ok: true,
        kind: created.kind,
        message:
          created.kind === "invited"
            ? `Invite sent to ${email}. They'll appear here as invited until they open it.`
            : `${name} already had an account -- they've been added to your organization and notified.`,
      });
    }

    if (body.action === "resend_invite") {
      if (!body.userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }
      const touched = await touchOrgInviteResend(org.accessCodeId, body.userId);
      if (!touched.ok) {
        return NextResponse.json({ error: touched.error }, { status: 400 });
      }
      try {
        const inviterName = (await auth())?.user?.name || null;
        const url = await mintInviteMagicLink(touched.email, origin);
        await sendOrgEmail(
          touched.email,
          buildInviteEmail({
            inviteeName: touched.name,
            inviterName,
            orgName: org.orgName,
            url,
            origin,
          })
        );
      } catch (err: any) {
        console.error("invite resend failed:", err?.message || err);
        return NextResponse.json(
          { error: "The email could not be sent. Try again in a minute." },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true, message: `Invite re-sent to ${touched.email}.` });
    }

    if (body.action === "revoke_invite") {
      if (!body.userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }
      const revoked = await revokeOrgInvite(org.accessCodeId, body.userId);
      if (!revoked.ok) {
        return NextResponse.json({ error: revoked.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, message: "Invite removed and the seat freed." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("partner org POST failed:", err?.message || err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
