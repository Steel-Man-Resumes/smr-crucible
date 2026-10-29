/**
 * The person's side of handoffs (migration 110, staff pass S5).
 *   GET                                              their live handoffs, each listing re-read
 *   POST { action: "seen", handoffId }               they opened it
 *   POST { action: "answer", itemId, answer: "take" | "pass" }
 * Taking an employer, a job or a place for help is SAVED FIRST by the page,
 * through their own existing routes (/api/applications, /api/resource-lists),
 * the same order as suggested jobs. Taking a next step puts it on their list
 * here, in one transaction. Runs as the person, with no organization scope.
 * Nobody acting for them (an admin view or an assist session) can open or
 * answer: "Only the person can answer this." (review r1 #3).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMyHandoffs, markMyHandoffSeen, answerMyHandoffItem } from "@crucible/core";
import { isSameOriginRequest } from "@/lib/same-origin";
import { actingForSomeoneElse } from "@/lib/hurdles/consent-server";
import { HANDOFFS_UNAVAILABLE } from "@/lib/my-handoffs-load";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    return NextResponse.json({ handoffs: await getMyHandoffs(session.user.id, { listings: true }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    // A failed read is never "nothing new" (demo review 2026-10-28): the page
    // says it could not load and offers Retry. Migration 110 is live.
    console.error("handoffs read failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: HANDOFFS_UNAVAILABLE }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  // Fails closed: an unreadable impersonation check counts as someone acting for them.
  if (await actingForSomeoneElse().catch(() => true)) return NextResponse.json({ error: "Only the person can answer this." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body?.action === "seen") {
    if (!UUID.test(String(body.handoffId ?? ""))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    await markMyHandoffSeen(session.user.id, String(body.handoffId));
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "answer") {
    if (!UUID.test(String(body.itemId ?? "")) || (body.answer !== "take" && body.answer !== "pass")) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const res = await answerMyHandoffItem(session.user.id, String(body.itemId), body.answer);
    return res.ok ? NextResponse.json({ ok: true, kind: res.kind }) : NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
