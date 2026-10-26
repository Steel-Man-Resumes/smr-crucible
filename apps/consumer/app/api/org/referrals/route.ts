/**
 * Closed-loop referrals (migration 105).
 *   GET  ?clientId=&filter=open|overdue|all|<status>&mine=1
 *   POST { action: "create", clientId, toKind, resourceId?, toName?, reason?, send?, ownerId?, dueOn? }
 *        { action: "move", referralId, to, reason?, dueOn? }
 *        { action: "update", referralId, ownerId?, dueOn?, toName?, reason? }
 *        { action: "history", referralId }
 * Every rule (reach, path, reasons, consent) is in core and in the database.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import {
  listReferrals, createReferral, moveReferral, updateReferral, getReferralHistory, listReferralOwners,
  REFERRAL_STATUSES, REFERRAL_STATUS_LABELS, REFERRAL_ACTION_LABELS, REFERRAL_TRANSITIONS, REFERRAL_TO_KINDS, REFERRAL_TO_KIND_LABELS, PARTNER_CONSENT_LINE,
} from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

/** The org guard, given this request (view-as aware: L2), then the staff workspace check. */
async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}
const s = (v: unknown) => (typeof v === "string" ? v : null);

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const clientId = u.searchParams.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ referrals: [] });
  const referrals = await listReferrals(g.actor, { clientId, filter: u.searchParams.get("filter"), mine: u.searchParams.get("mine") === "1" });
  if (!referrals) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({
    referrals,
    canWrite: g.actor.capabilities.has("org.task.write") && !g.actor.viaPlatformAdmin,
    me: g.actor.userId,
    // Handing a referral to a colleague is for people who assign work.
    owners: g.actor.capabilities.has("org.client.assign") ? await listReferralOwners(g.actor) : [],
    options: {
      statuses: REFERRAL_STATUSES.map((v) => ({ value: v, label: REFERRAL_STATUS_LABELS[v], action: REFERRAL_ACTION_LABELS[v], next: REFERRAL_TRANSITIONS[v] })),
      toKinds: REFERRAL_TO_KINDS.map((v) => ({ value: v, label: REFERRAL_TO_KIND_LABELS[v] })),
      partnerConsentLine: PARTNER_CONSENT_LINE,
    },
  });
}

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const b = await readJson(request);
  const rid = s(b.referralId) ?? "";
  if (b.action !== "create" && !UUID.test(rid)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (b.action === "history") {
    const events = await getReferralHistory(g.actor, rid);
    return events ? NextResponse.json({ events }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const res =
    b.action === "create" ? await createReferral(g.actor, {
      clientId: s(b.clientId) ?? "", toKind: s(b.toKind) ?? "", resourceId: s(b.resourceId), toName: s(b.toName), reason: s(b.reason),
      send: b.send === true, ownerId: s(b.ownerId), dueOn: s(b.dueOn),
    })
    : b.action === "move" ? await moveReferral(g.actor, rid, { to: s(b.to) ?? "", reason: s(b.reason), dueOn: s(b.dueOn) })
    : b.action === "update" ? await updateReferral(g.actor, rid, {
      ownerId: "ownerId" in b ? s(b.ownerId) : undefined, dueOn: "dueOn" in b ? s(b.dueOn) : undefined, toName: s(b.toName), reason: s(b.reason),
    })
    : null;
  if (!res) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return res.ok ? NextResponse.json({ ok: true, id: res.id, note: res.note ?? null }) : NextResponse.json({ error: res.error }, { status: 400 });
}
