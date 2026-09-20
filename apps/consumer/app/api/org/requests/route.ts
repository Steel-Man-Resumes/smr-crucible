/**
 * Sharing requests across the caller's caseload.
 *   GET                         the list, open ones first
 *   POST { action: "withdraw", requestId }
 * Access is decided in orgClientView, not here.
 */
import { NextResponse } from "next/server";
import { getOne, listSharingRequests, withdrawSharingRequest } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate() {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard;
  const row = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!row?.crm_v2) return { ok: false as const, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return guard;
}

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.response;
  const res = await listSharingRequests(g.actor);
  if (!res.ok) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ requests: res.rows, viewerId: g.actor.userId });
}

export async function POST(request: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  const body = await request.json().catch(() => ({}));
  if (body.action !== "withdraw" || !UUID.test(String(body.requestId ?? ""))) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const res = await withdrawSharingRequest(g.actor, String(body.requestId));
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That request is no longer open, or is not yours to withdraw." }, { status: 400 });
}
