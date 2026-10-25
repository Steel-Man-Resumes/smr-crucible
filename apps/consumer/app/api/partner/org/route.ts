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
import { requireOrgCapability } from "@/lib/org-guard";
import {
  getOne,
  resolveOrgActor,
  getUserTier,
  getOrgContext,
  getOrgStaff,
  getPartnerCohort,
  getOrgAssignmentCounts,
  assignClientStaff,
  addOrgStaff,
  setOrgStaffRole,
  removeOrgStaff,
  getOrgPendingInvites,
  createOrgInvite,
  touchOrgInviteResend,
  revokeOrgInvite,
  recordDataAccess,
  getOrgSeatLedger,
  getOrgInviteSender,
  getInvitedNotSharing,
  inviteActionAllowed,
  getOrgBrand,
  DEFAULT_ORG_BRAND,
} from "@crucible/core";
import { isValidEmail } from "@/lib/auth-rate-limit";
import { adminSecondFactorOk } from "@/lib/session-policy";
import {
  mintInviteMagicLink,
  buildInviteEmail,
  buildOfferEmail,
  sendOrgEmail,
} from "@/lib/org-invite-email";

export const maxDuration = 15;

async function resolveContext(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return { error: 401 as const };
  const tier = await getUserTier(session.user.id);
  // The cross-org admin view needs a session that entered a two-step code (F1).
  const adminPowers = tier === "admin" && adminSecondFactorOk(session.user as any);
  const { searchParams } = new URL(request.url);
  const overrideCodeId =
    adminPowers ? searchParams.get("codeId") || undefined : undefined;
  const org = await getOrgContext(session.user.id, {
    isAdmin: adminPowers,
    overrideCodeId,
  });
  if (!org) return { error: 403 as const };
  return { org, userId: session.user.id, tier, adminPowers };
}

/** The one reply to "Add participant", whatever the address turned out to be. */
const INVITE_NEUTRAL_MESSAGE =
  "Done. If that address can be added, they get an email from us. New accounts show under Invited until they open it; people who already have an account join when they say yes.";

export async function GET(request: Request) {
  const ctx = await resolveContext(request);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "Not authenticated" : "No org access" },
      { status: ctx.error }
    );
  }
  const { org, userId, adminPowers } = ctx;
  // WHAT THIS PERSON SEES IS DECIDED BY THEIR CAPABILITIES, not their role name.
  // It used to be `owner or org_admin` inline, so switching one case manager to
  // "see everyone", or an admin's AI-cost view off, changed nothing on screen.
  // The role is only the fallback when no actor can be resolved.
  const roleIsAdmin = org.role === "owner" || org.role === "org_admin";
  const actor = await resolveOrgActor(userId, { isPlatformAdmin: adminPowers, orgId: org.accessCodeId }).catch(() => null);
  const can = (cap: Parameters<NonNullable<typeof actor>["capabilities"]["has"]>[0], fallback: boolean) =>
    actor ? actor.capabilities.has(cap) : fallback;
  const isOrgAdmin = can("org.client.view_all", roleIsAdmin);
  const seesCosts = can("org.costs.view", org.role === "owner");
  const seesSeats = can("org.seats.view", roleIsAdmin);
  const managesStaff = can("org.staff.manage", roleIsAdmin);

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
    const clients = seesCosts
      ? cohort.clients
      : cohort.clients.map((c) => ({ ...c, aiCostUsd: 0 }));

    // Audit trail (data_access_log, Phase 1B) -- non-fatal, never blocks the read.
    await recordDataAccess({
      accessorUserId: userId,
      resource: "partner_org",
      action: "read",
      context: { clientCount: clients.length },
    });

    // Counts only, so an empty staff list can say why and who to ask. Never
    // blocks the page: without them the console falls back to its old wording.
    const counts = await getOrgAssignmentCounts(org.accessCodeId, userId).catch((err) => {
      console.error("org assignment counts failed:", err?.message || err);
      return null;
    });

    // Seat truth: claimed (what the cap is checked against), active (members
    // now) and free (total minus claimed). Only for people who may see seats.
    const seats = seesSeats
      ? await getOrgSeatLedger(org.accessCodeId, userId).catch((err) => {
          console.error("org seat ledger failed:", err?.message || err);
          return null;
        })
      : null;

    // People the organization invited who have not turned on sharing, so they
    // can be assigned (R3 review S8). Names and emails the organization typed,
    // nothing else. Only for people who assign and see everyone.
    const canAssign = can("org.client.assign", roleIsAdmin);
    const invitedNotSharing = canAssign && isOrgAdmin
      ? await getInvitedNotSharing(org.accessCodeId, userId).catch((err) => {
          console.error("invited-not-sharing read failed:", err?.message || err);
          return [];
        })
      : [];

    // The per-participant pages and scoped sharing, switched on per org.
    const flag = await getOne<{ crm_v2: boolean }>(
      `SELECT crm_v2 FROM access_code WHERE id = $1`,
      [org.accessCodeId]
    );

    return NextResponse.json({
      crmV2: !!flag?.crm_v2,
      quietAfterDays: await (await import("@crucible/core")).getQuietAfterDays(org.accessCodeId),
      org: {
        // The organization id (not the code): what <OrgMark> and the logo
        // route take. Safe for every member; it is not a seat key.
        orgId: org.accessCodeId,
        name: org.orgName,
        // Logo present and branding tier, read as this user (org_brand is
        // row-level protected). Never bytes, never a URL.
        brand: await getOrgBrand(userId, org.accessCodeId).catch(() => ({ ...DEFAULT_ORG_BRAND })),
        // The code IS the seat key (anyone signed in can redeem it), so only
        // people who may see seats get it (R3 B2 item 4).
        code: seesSeats ? org.code : null,
        logoUrl: org.logoUrl,
        role: org.role,
        // Seat cap is org-admin/owner information (null = unlimited).
        seatLimit: seesSeats ? org.seatLimit : null,
      },
      seats,
      // Contact details by need (R3 review S3): staff emails only to people
      // who manage staff; pending invites (names and emails the organization
      // typed) only to people who see everyone, or to the person who sent each.
      staff: managesStaff ? staff : staff.map((m) => ({ ...m, email: null })),
      cohort: { ...cohort, clients },
      invites: isOrgAdmin ? invites : invites.filter((i) => i.invitedById === userId),
      canManage: managesStaff,
      canAssign,
      invitedNotSharing,
      seesEveryone: isOrgAdmin,
      unassignedJoined: counts?.unassignedJoined ?? null,
      assignedToViewer: counts?.assignedToViewer ?? null,
      canInvite: can("org.participant.invite", true),
      showCosts: seesCosts,
      capabilities: actor ? Array.from(actor.capabilities) : [],
    });
  } catch (err: any) {
    console.error("partner org GET failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // WHICH ORGANIZATION IS THIS WRITE FOR?
  //
  // The console lets a platform admin VIEW another organization by passing
  // ?codeId=. Reads honoured it and writes did not -- so an admin looking at
  // org B could unassign a participant and the DELETE executed against their
  // OWN org A, silently, while the screen showed B. assignClientStaff ignored
  // the row count, so it reported success either way. If that participant also
  // had an assignment in A, it deleted the wrong organization's row.
  //
  // requireOrgCapability only honours this for a platform admin -- for anyone
  // else resolveOrgActor falls back to their own membership, so a request
  // cannot nominate an org it does not belong to. (Found in review.)
  const selectedOrgId =
    new URL(request.url).searchParams.get("codeId") || undefined;
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

    // ── Staff management (org admins and the owner) ─────────────────────
    // org_staff previously had no write path in the product at all: three
    // one-off seed scripts were the only things that ever inserted into it.
    if (
      body.action === "add_staff" ||
      body.action === "set_staff_role" ||
      body.action === "remove_staff"
    ) {
      const guard = await requireOrgCapability("org.staff.manage", { orgId: selectedOrgId });
      if (!guard.ok) return guard.response;

      const targetUserId = String(body.userId || "");
      if (!targetUserId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }

      const result =
        body.action === "add_staff"
          ? await addOrgStaff({
              orgId: guard.actor.orgId,
              userId: targetUserId,
              role: body.role === "org_admin" ? "org_admin" : "staff",
              title: typeof body.title === "string" ? body.title : null,
              addedBy: guard.actor.userId,
            })
          : body.action === "set_staff_role"
            ? await setOrgStaffRole({
                orgId: guard.actor.orgId,
                userId: targetUserId,
                role: body.role === "org_admin" ? "org_admin" : "staff",
                actorUserId: guard.actor.userId,
              })
            : await removeOrgStaff({
                orgId: guard.actor.orgId,
                userId: targetUserId,
                actorUserId: guard.actor.userId,
              });

      if (!result.ok) {
        // A refusal here is an authorization or state outcome with a message
        // written to be shown, not an internal error.
        return NextResponse.json({ error: result.reason }, { status: 403 });
      }
      return NextResponse.json({ ...result, ok: true });
    }

    if (body.action === "assign") {
      // First route on the capability guard. The inline `isOrgAdmin` boolean it
      // replaces was correct, but it was one of a dozen hand-rolled checks with
      // no single place to audit; this one asks the resolver, which reads
      // membership from the database on every request.
      const guard = await requireOrgCapability("org.client.assign", { orgId: selectedOrgId });
      if (!guard.ok) return guard.response;
      if (!body.clientUserId) {
        return NextResponse.json({ error: "clientUserId required" }, { status: 400 });
      }
      try {
        await assignClientStaff(
          guard.actor.orgId,
          body.clientUserId,
          body.staffUserId || null,
          userId
        );
      } catch (err) {
        // assignClientStaff refuses a participant or staff member who does not
        // belong to this org. That is a 403, not a 500 -- it is an
        // authorization outcome, and the message is safe to show.
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Could not assign." },
          { status: 403 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Invite actions: open to org admins AND staff (Troy 2026-08-05).
    if (body.action === "invite") {
      // Inviting a participant spends a seat. An owner can switch it off for
      // one person; until now nothing checked, so the switch would have lied.
      const inviteGuard = await requireOrgCapability("org.participant.invite", { orgId: selectedOrgId });
      if (!inviteGuard.ok) return inviteGuard.response;
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
      // Not for an offer: that person is not a member until they say yes.
      if (org.role === "staff" && created.kind === "invited") {
        await assignClientStaff(org.accessCodeId, created.userId, userId, userId).catch(
          (err) => console.error("invite auto-assign failed:", err?.message || err)
        );
      }

      // State is committed; the email is the last step. ONE answer to staff
      // whether the address was new, already had an account, or was asked in
      // the last day (security review 1, SF-2; R3 S4 for this path), and no
      // kind in the response. An offer made or answered in the last 24 hours
      // sends nothing again (createOrgInvite notify).
      if (created.notify) {
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
              buildOfferEmail({ inviteeName: name, inviterName, orgName: org.orgName, origin })
            );
          }
        } catch (err: any) {
          // Logged, not shown: a different answer here would tell staff which
          // kind of address it was. New invitees can be re-sent from the list.
          console.error("invite email failed:", err?.message || err);
        }
      }

      return NextResponse.json({ ok: true, message: INVITE_NEUTRAL_MESSAGE });
    }

    // Resend and revoke run the same capability check as sending an invite
    // (R3 review S2): before this, anyone the context resolved could revoke
    // any pending invite (freeing that seat) or re-send sign-in links, even
    // with "Invite participants" switched off. Someone who does not see the
    // whole organization may act only on invites they sent themselves.
    if (body.action === "resend_invite" || body.action === "revoke_invite") {
      const inviteGuard = await requireOrgCapability("org.participant.invite", { orgId: selectedOrgId });
      if (!inviteGuard.ok) return inviteGuard.response;
      if (!body.userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }
      // ONE ORGANIZATION for the check and the write (review SF1). The guard
      // honours ?codeId for anyone who belongs to that org, while the context
      // the write runs in ignores it for non-admins, so a person on staff in
      // two orgs could pass the check in one and revoke in the other.
      if (inviteGuard.actor.orgId !== org.accessCodeId) {
        return NextResponse.json({ error: "No invite found for that person." }, { status: 404 });
      }
      if (!inviteActionAllowed({
        capabilities: inviteGuard.actor.capabilities,
        actorUserId: inviteGuard.actor.userId,
        invitedBy: await getOrgInviteSender(org.accessCodeId, String(body.userId)),
      })) {
        return NextResponse.json({ error: "No invite found for that person." }, { status: 404 });
      }
    }

    if (body.action === "resend_invite") {
      if (!body.userId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }
      const touched = await touchOrgInviteResend(org.accessCodeId, body.userId, { actorUserId: userId });
      if (!touched.ok) {
        return NextResponse.json({ error: touched.error }, { status: 400 });
      }
      try {
        const inviterName = (await auth())?.user?.name || null;
        if (touched.offer) {
          // An open offer to an existing account: the offer email, never a sign-in link.
          await sendOrgEmail(
            touched.email,
            buildOfferEmail({ inviteeName: touched.name, inviterName, orgName: org.orgName, origin })
          );
        } else {
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
        }
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
      const revoked = await revokeOrgInvite(org.accessCodeId, body.userId, userId);
      if (!revoked.ok) {
        return NextResponse.json({ error: revoked.error }, { status: 400 });
      }
      // One message for an invite and an offer: any seat it held is free again (an offer held none).
      return NextResponse.json({ ok: true, message: "Invite removed. Any seat it held is free again." });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("partner org POST failed:", err?.message || err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
