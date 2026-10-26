/**
 * Staff search: GET ?q=&scope=mine|all. Case-insensitive and forgiving, over
 * what staff may already see of each person (orgSearch.ts says exactly what),
 * limited to the people the caller reaches. Never a lookup for whether an
 * account exists.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { searchParticipants } from "@crucible/core";
import { withCrm } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

/** The org guard, given this request (view-as aware: L2), then the staff workspace check. */
async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.client.view_content", { request }));
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 120);
  const scope = u.searchParams.get("scope") === "mine" ? "mine" : "all";
  const started = Date.now();
  const hits = await searchParticipants(g.actor, q, { scope, limit: 20 });
  if (!hits) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ hits, scope, seesAll: g.actor.capabilities.has("org.client.view_all"), ms: Date.now() - started });
}
