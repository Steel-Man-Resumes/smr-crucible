/**
 * Handoffs to one person (migration 110, staff pass S5).
 *   GET                                    what staff sent them and each answer (waiting, taken, passed)
 *   POST { action: "send", note, items }   send a handoff (org.suggest.write); "drafted with t.ROY" is set by the server
 *   POST { action: "withdraw", handoffId }                      take back what is still open
 * Reach, the item rules and the live directory check are in core and in the
 * database; this route only gates and reads the body. Never under view-as.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { listHandoffsFor, sendHandoff, withdrawHandoff, canSendHandoff } from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

/** Writes: the org guard for sending (view-as aware, L2), then the staff workspace check. */
async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.suggest.write", { request }));
}

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await withCrm(await requireOrgCapability("org.client.view_content", { request }));
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const handoffs = await listHandoffsFor(g.actor, id);
  if (!handoffs) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ handoffs, canSend: canSendHandoff(g.actor) });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const { id } = await props.params;
  const g = await gate(request);
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = await readJson(request);
  if (b.action === "send") {
    // draftedByAssistant is decided by the server from the t.ROY run log; the browser's value is ignored.
    const res = await sendHandoff(g.actor, id, { note: b.note, items: b.items });
    return res.ok ? NextResponse.json({ ok: true, id: res.id, items: res.items }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  if (b.action === "withdraw") {
    const hid = typeof b.handoffId === "string" ? b.handoffId : "";
    if (!UUID.test(hid)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return (await withdrawHandoff(g.actor, hid))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Already withdrawn, or not yours to withdraw." }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
