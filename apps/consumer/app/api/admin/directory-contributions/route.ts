/**
 * The SMR data owner's queue of staff directory contributions (migration 112,
 * lane S6). Platform admin with two-step sign-in only.
 *
 *   GET ?status=open|received|approved|needs_more|not_used|withdrawn|all
 *   POST { action: "decide", id, status: "approved"|"needs_more"|"not_used", outcome?, answer? }
 *   POST { action: "record_call", id, checkId?, placeId? }
 *
 * Deciding never publishes: an approval records the decision and the credit
 * (never shown publicly yet). "record_call" writes the documented interaction
 * an approved live call is (employer relationship confirmation, or the
 * resource R3 event bound to the live check), in the program's name.
 */
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { listContributionQueue, decideContribution, applyContributionCall } from "@crucible/core";

export const dynamic = "force-dynamic";
const STATUSES = ["open", "received", "approved", "needs_more", "not_used", "withdrawn", "all"] as const;

export async function GET(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const s = new URL(request.url).searchParams.get("status") ?? "open";
  const status = (STATUSES as readonly string[]).includes(s) ? s : "open";
  try {
    return NextResponse.json({ data: await listContributionQueue(guard.userId, { status: status as never }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The queue could not be read." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { isSameOriginJsonPost } = await import("@/lib/same-origin");
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    if (body.action === "decide") {
      const res = await decideContribution(guard.userId, String(body.id ?? ""), body.status, body.outcome ?? null, body.answer ?? null);
      return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.reason }, { status: 400 });
    }
    if (body.action === "record_call") {
      const res = await applyContributionCall(guard.userId, String(body.id ?? ""), body.checkId ? String(body.checkId) : null, body.placeId ? String(body.placeId) : null);
      return res.ok ? NextResponse.json({ ok: true, wrote: res.wrote }) : NextResponse.json({ error: res.reason }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "That could not be saved." }, { status: 503 });
  }
  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
