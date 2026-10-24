/**
 * POST /api/seat/request: ask Troy for a Refinery seat (his review queue,
 * progression_request kind 'seat'). Signed in, same-origin JSON, a per-IP daily
 * cap on top of the per-account limits in requestSeat. The account email is
 * the contact: no second address is accepted.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { checkAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { SEAT_REQUEST_PER_IP, SeatRequestError, requestSeat } from "@/lib/refinery-access-server";

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const text = await request.text();
  if (text.length > 3000) return NextResponse.json({ error: "Request too long." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Check the request and try again." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Check the request and try again." }, { status: 400 });
  const limit = await checkAuthRateLimit(`seat:request:ip:${getClientIp(request)}`, SEAT_REQUEST_PER_IP);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests from this connection today. Try again tomorrow." }, { status: 429 });
  try {
    return NextResponse.json(await requestSeat(userId, body as Record<string, unknown>));
  } catch (error) {
    if (error instanceof SeatRequestError) {
      return NextResponse.json({ error: "Check your note: 5 to 1000 characters, or leave it empty." }, { status: 400 });
    }
    return NextResponse.json({ error: "Your request did not save. Try again shortly." }, { status: 503 });
  }
}
