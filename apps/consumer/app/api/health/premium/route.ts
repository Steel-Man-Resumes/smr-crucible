/**
 * Premium readiness (Codex review A8), for a signed-in platform admin only
 * (review L5): whether PREMIUM_GATE is on and migration 079's tables are
 * there. Anyone else gets the plain 401/403 from requirePlatformAdmin and
 * nothing is read.
 *
 *   gate off            200 { ok: true, gate: false }   nothing is read
 *   gate on, ready      200 { ok: true, gate: true, ready: true }
 *   gate on, not ready  503 { ok: false, gate: true, ready: false }
 *
 * The table check is reused for a minute (cachedPremiumStorageReady), so
 * polling this never keeps the database awake. While storage is missing, the
 * sponsored tools answer "temporarily unavailable" (lib/premium-server.ts)
 * instead of opening. Open it in a browser signed in as a platform admin
 * before and after turning PREMIUM_GATE on (docs/SHIP-DAY-GATES.md).
 */
import { NextResponse } from "next/server";
import { premiumGateOn } from "@/lib/premium";
import { cachedPremiumStorageReady } from "@/lib/premium-server";
import { requirePlatformAdmin } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requirePlatformAdmin();
  if (!admin.ok) return admin.response;
  const headers = { "Cache-Control": "no-store" };
  const { premiumReadiness } = await import("@crucible/core");
  if (!premiumGateOn()) return NextResponse.json(premiumReadiness(false, null), { status: 200, headers });
  const verdict = premiumReadiness(true, await cachedPremiumStorageReady());
  return NextResponse.json(verdict, { status: verdict.ok ? 200 : 503, headers });
}
