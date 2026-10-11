/**
 * Premium readiness (Codex review A8). Public: { ok, gate, ready } only, no
 * person's data.
 *
 *   gate off            200 { ok: true, gate: false }   nothing is read
 *   gate on, ready      200 { ok: true, gate: true, ready: true }
 *   gate on, not ready  503 { ok: false, gate: true, ready: false }
 *
 * "Not ready" means migration 079's tables are missing. While that is true
 * the sponsored tools answer "temporarily unavailable" (lib/premium-server.ts)
 * instead of opening. Check this returns 200 before and after turning
 * PREMIUM_GATE on (docs/SHIP-DAY-GATES.md).
 */
import { NextResponse } from "next/server";
import { premiumGateOn } from "@/lib/premium";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const { premiumReadiness, premiumStorageReady } = await import("@crucible/core");
  const gate = premiumGateOn();
  if (!gate) return NextResponse.json(premiumReadiness(false, null), { status: 200, headers });
  let ready: boolean | null;
  try {
    ready = await premiumStorageReady();
  } catch {
    ready = null;
  }
  const verdict = premiumReadiness(true, ready);
  return NextResponse.json(verdict, { status: verdict.ok ? 200 : 503, headers });
}
