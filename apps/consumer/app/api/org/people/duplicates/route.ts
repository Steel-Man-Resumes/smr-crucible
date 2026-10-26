/**
 * Before adding or inviting someone: POST { name, email, phone } returns the
 * people this caller works with who look the same (named, with why), and a
 * count of anyone else who does (never named). See orgSearch.findPossibleDuplicates.
 */
import { NextResponse } from "next/server";
import { findPossibleDuplicates } from "@crucible/core";
import { crmGate, refuseCrossOrigin, readJson } from "@/lib/org-crm-gate";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";

/** S6: the warning answers while someone types, but it is not a lookup service. Per signed-in staff member. */
const DUPLICATE_CHECKS_PER_USER = { maxRequests: 60, windowMs: 10 * 60_000 };

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await crmGate("org.participant.invite");
  if (!g.ok) return g.response;
  const limit = await checkAuthRateLimit(`org:duplicates:user:${g.actor.userId}`, DUPLICATE_CHECKS_PER_USER);
  if (!limit.allowed) return NextResponse.json({ error: "Too many checks for now. Try again in a few minutes." }, { status: 429 });
  const b = await readJson(request);
  const report = await findPossibleDuplicates(g.actor, { name: str(b.name, 200), email: str(b.email, 320), phone: str(b.phone, 40) });
  if (!report) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json(report);
}
