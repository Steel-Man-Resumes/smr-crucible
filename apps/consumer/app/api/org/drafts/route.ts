/**
 * Autosaved drafts: only ever the caller's own (migration 105 staff_draft is
 * owner-only in the database; this route cannot ask for anyone else's).
 *   GET    ?clientId=&kind=            the caller's draft, or null
 *   PUT    { clientId|null, kind, body }   save (empty body clears)
 *   POST   same as PUT (navigator.sendBeacon sends POST when a page closes)
 * Every write must come from this app's own pages (same-origin), checked first.
 *   DELETE ?clientId=&kind=            clear (after the real thing saved)
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { getStaffDraft, saveStaffDraft, clearStaffDraft, draftKindOk, type OrgActor } from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

/** The org guard, given this request (view-as aware: L2), then the staff workspace check. */
async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}

function who(v: unknown): string | null | false {
  if (v == null || v === "") return null;
  return typeof v === "string" && UUID.test(v) ? v : false;
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const clientId = who(u.searchParams.get("clientId")), kind = u.searchParams.get("kind");
  // org: the organization this session acts for, so this device's copy is keyed by it too (review B2).
  if (clientId === false || !draftKindOk(kind)) return NextResponse.json({ draft: null, org: g.actor.orgId });
  return NextResponse.json({ draft: await getStaffDraft(g.actor, clientId, kind), org: g.actor.orgId });
}

async function save(request: Request, actor: OrgActor) {
  const b = await readJson(request);
  const clientId = who(b.clientId);
  if (clientId === false || !draftKindOk(b.kind) || typeof b.body !== "string") return NextResponse.json({ error: "Not saved." }, { status: 400 });
  const res = await saveStaffDraft(actor, clientId, b.kind as string, b.body);
  return res.ok ? NextResponse.json({ ok: true, savedAt: res.savedAt }) : NextResponse.json({ error: res.error }, { status: 400 });
}

export async function PUT(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  return save(request, g.actor);
}

/** navigator.sendBeacon sends POST when a page closes. */
export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  return save(request, g.actor);
}

export async function DELETE(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const clientId = who(u.searchParams.get("clientId")), kind = u.searchParams.get("kind");
  if (clientId === false || !draftKindOk(kind)) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: await clearStaffDraft(g.actor, clientId, kind) });
}
