/**
 * Admin system-health endpoint. Admin-tier only. Returns the live health report
 * (DB, auth, email/Resend domain, AI-key validity, integrations) -- no secret
 * values. This is the in-app readout for the new universe + cutover checks.
 */

import { NextResponse } from "next/server";
import { getSystemHealth } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export const maxDuration = 30;

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  try {
    const report = await getSystemHealth();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error("Health check error:", err?.message || err);
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
