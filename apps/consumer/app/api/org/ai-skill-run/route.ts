/**
 * Staff t.ROY skill runs (migration 106, house build L6).
 *
 *   POST { action: "accept", id }   the staff member used the answer: saved a
 *                                    draft from it or copied it. Marks the run
 *                                    accepted by them, once.
 *
 * The route decides nothing about access: acceptSkillRun runs as the staff
 * member through runScoped, and the 106 guard and policies allow only the
 * person who ran it, only once. A view-as session never writes.
 */
import { NextResponse } from "next/server";
import { acceptSkillRun } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { effectiveAuth } from "@/lib/effective-auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.client.view_content", { request });
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  if (actor.viaPlatformAdmin || (await effectiveAuth())?.user?.id !== actor.userId) {
    return NextResponse.json({ error: "Nothing is saved while you are viewing as someone else." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "accept" || !UUID.test(String(body?.id ?? ""))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const ok = await acceptSkillRun(actor, String(body.id));
  // Not yours, not found and already accepted look the same from outside.
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 });
}
