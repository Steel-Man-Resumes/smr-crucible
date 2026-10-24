/**
 * POST /api/seat/offer {offerId, answer: "accept" | "decline"}: the person
 * answers an organization's offer. Only offers made to THIS account can be
 * answered (smr_accept_seat_offer / smr_decline_seat_offer check the owner).
 * Accepting spends the organization's seat, through smr_redeem_code.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { acceptSeatOffer, declineSeatOffer } from "@crucible/core";
import { isSameOriginJsonPost } from "@/lib/same-origin";

const ACCEPT_MESSAGES: Record<string, { status: number; message: string }> = {
  ok: { status: 200, message: "You joined. The Refinery is open to you." },
  already_member: { status: 200, message: "You were already part of this organization." },
  other_org: { status: 409, message: "You already belong to another organization. Ask Steel Man Resumes if you should move to this one." },
  full: { status: 409, message: "That organization has no seats left right now. Ask them about it." },
  inactive: { status: 409, message: "That offer is no longer open." },
  expired: { status: 409, message: "That offer is no longer open." },
  not_found: { status: 404, message: "That offer is no longer open." },
};

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const offerId = typeof body?.offerId === "string" ? body.offerId : "";
  const answer = body?.answer;
  if (!/^[0-9a-f-]{36}$/i.test(offerId) || (answer !== "accept" && answer !== "decline")) {
    return NextResponse.json({ error: "Check the request and try again." }, { status: 400 });
  }
  try {
    if (answer === "decline") {
      const out = await declineSeatOffer(userId, offerId);
      return out === "ok"
        ? NextResponse.json({ ok: true, message: "Declined. Nothing changed on your account." })
        : NextResponse.json({ error: "That offer is no longer open." }, { status: 404 });
    }
    const outcome = await acceptSeatOffer(userId, offerId);
    const m = ACCEPT_MESSAGES[outcome] ?? ACCEPT_MESSAGES.not_found;
    return m.status === 200
      ? NextResponse.json({ ok: true, message: m.message })
      : NextResponse.json({ error: m.message }, { status: m.status });
  } catch {
    return NextResponse.json({ error: "Your answer did not save. Try again shortly." }, { status: 503 });
  }
}
