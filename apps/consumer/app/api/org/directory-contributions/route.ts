/**
 * Staff directory contributions (migration 112, lane S6).
 *
 *   GET                      my submissions and their answers (the program's,
 *                            for its owner or an org admin); never a private note
 *   POST { flow, targetKind, targetId?, details, interactionOn?, interactionMethod?,
 *          sourceUrl?, privateNote?, creditOrgOk?, creditPersonOk? }
 *                            send one to the SMR data owner's review queue
 *   PATCH { id }             take back one that has not been answered
 *
 * Nothing here publishes anything. The words carry no record details, and the
 * form has no field for a participant: this is about the place, not a person
 * on anyone's caseload.
 */
import { NextResponse } from "next/server";
import { submitContribution, listMyContributions, withdrawContribution, contributionFreeText, normalizeContribution } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { effectiveAuth } from "@/lib/effective-auth";
import { mayWrite, recordWordsIn, todayUtc, VIEWING_REFUSAL } from "@/lib/staff-rewards-route";

export const dynamic = "force-dynamic";
const RECORD_REFUSAL = "Keep anyone's record, court or supervision details out of this. It is about the place.";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  if (guard.viewing || guard.actor.viaPlatformAdmin) return NextResponse.json({ contributions: [] });
  return NextResponse.json({ contributions: await listMyContributions(guard.actor) }, { headers: { "Cache-Control": "private, no-store" } });
}

async function writer(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return { response: guard.response } as const;
  const session = await effectiveAuth();
  if (!mayWrite({ viewing: guard.viewing, viaPlatformAdmin: guard.actor.viaPlatformAdmin, actorUserId: guard.actor.userId, sessionUserId: session?.user?.id })) {
    return { response: NextResponse.json({ error: VIEWING_REFUSAL }, { status: 403 }) } as const;
  }
  return { actor: guard.actor } as const;
}

export async function POST(request: Request) {
  const w = await writer(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => null);
  const today = todayUtc();
  const norm = normalizeContribution(body, today);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  if (recordWordsIn(contributionFreeText(norm.value))) return NextResponse.json({ error: RECORD_REFUSAL }, { status: 400 });
  const res = await submitContribution(w.actor, body, today);
  return res.ok ? NextResponse.json({ ok: true, id: res.id }) : NextResponse.json({ error: res.reason }, { status: 400 });
}

export async function PATCH(request: Request) {
  const w = await writer(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => ({}));
  const ok = await withdrawContribution(w.actor, String(body?.id ?? ""));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false }, { status: 404 });
}
