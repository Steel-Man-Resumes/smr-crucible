/**
 * STUB (nav lane, 2026-10-23). The Steel Man meter lane replaces this file
 * whole. Contract: GET returns {asOf, score, maxScore, band:{id,label,why},
 * components:[...], steelMan, nextGain}. Until then it answers 404 so the
 * nav's meter renders nothing.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ error: "not ready" }, { status: 404 });
}
