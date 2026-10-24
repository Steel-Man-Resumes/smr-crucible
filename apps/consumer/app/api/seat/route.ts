/**
 * GET /api/seat: what the seat page shows, for the signed-in person only.
 * Whether the Refinery is open to everyone, whether this account has a seat,
 * offers from organizations waiting on a yes or no, this person's seat
 * requests, and whether a Forge package was already emailed to them (a real
 * row in forge_package_email_sent, never a guess). Seat-exempt
 * (lib/refinery-access.ts) and behind the second-step hold like any API.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOneAsUser, listMySeatOffers } from "@crucible/core";
import { mySeatRequests, readSeat } from "@/lib/refinery-access-server";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const [gate, offers, requests, emailed] = await Promise.all([
      readSeat(userId),
      listMySeatOffers(userId),
      mySeatRequests(userId),
      getOneAsUser<{ sent_at: string }>(
        userId,
        "SELECT sent_at FROM forge_package_email_sent WHERE user_id=$1 ORDER BY sent_at DESC LIMIT 1",
        [userId]
      ).catch(() => null),
    ]);
    return NextResponse.json(
      {
        open: gate.open,
        seat: gate.seat,
        offers,
        requests: requests.map((r) => ({ id: r.id, status: r.status, note: r.decision_note, createdAt: r.created_at })),
        packageEmailed: !!emailed,
      },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json({ error: "Your seat could not be checked. Try again shortly." }, { status: 503, headers: NO_STORE });
  }
}
