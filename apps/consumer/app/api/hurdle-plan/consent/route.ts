/**
 * /api/hurdle-plan/consent: the planner's own yes for record answers (migration 095).
 *   GET    -> { granted, version, current }
 *   POST   -> records the yes at the current text version
 *   DELETE -> takes the yes back
 * The person's own session only: staff acting as the person can do none of these.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSameOriginJsonPost, isSameOriginRequest } from "@/lib/same-origin";
import { actingForSomeoneElse, grantRecordPlanner, recordPlannerConsent, revokeRecordPlanner, RECORD_PLANNER_CONSENT_VERSION } from "@/lib/hurdles/consent-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function owner(): Promise<string | Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers });
  if (await actingForSomeoneElse()) return NextResponse.json({ error: "Only the person can answer this.", code: "staff_cannot_consent" }, { status: 403, headers });
  return userId;
}

export async function GET() {
  const who = await owner();
  if (typeof who !== "string") return who;
  try {
    const c = await recordPlannerConsent(who);
    return NextResponse.json({ ...c, current: RECORD_PLANNER_CONSENT_VERSION }, { headers });
  } catch { return NextResponse.json({ error: "Your answer could not be checked. Try again." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403, headers });
  const who = await owner();
  if (typeof who !== "string") return who;
  try { await grantRecordPlanner(who); return NextResponse.json({ granted: true, version: RECORD_PLANNER_CONSENT_VERSION }, { headers }); }
  catch { return NextResponse.json({ error: "Your yes did not save, so record answers stay away from the AI. Try again." }, { status: 503, headers }); }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403, headers });
  const who = await owner();
  if (typeof who !== "string") return who;
  try { await revokeRecordPlanner(who); return NextResponse.json({ granted: false }, { headers }); }
  catch { return NextResponse.json({ error: "That did not save. Try again." }, { status: 503, headers }); }
}
