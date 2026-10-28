/**
 * The one-line ask after a staff member uses a listing for someone (lane S6):
 * "Did this place still check out? Called them lately?"
 *
 *   POST { kind: "employer" | "resource", id }  ->  { line: string | null }
 *
 * A line comes back at most once per listing per week per person, and only
 * while this person's t.ROY suggestions are on. Never an error: no line is
 * the quiet answer.
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { listingNudgeFor } from "@/lib/staff-listing-nudge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  if (guard.viewing || guard.actor.viaPlatformAdmin) return NextResponse.json({ line: null });
  const body = await request.json().catch(() => ({}));
  const kind = body?.kind === "employer" || body?.kind === "resource" ? body.kind : null;
  if (!kind) return NextResponse.json({ line: null });
  const nudge = await listingNudgeFor(guard.actor, { kind, id: String(body?.id ?? "") }, { loadCore: () => import("@crucible/core") });
  return NextResponse.json({ line: nudge?.line ?? null, flows: nudge?.flows ?? [] });
}
