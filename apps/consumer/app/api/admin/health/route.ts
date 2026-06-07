/**
 * Admin system-health endpoint. Admin-tier only. Returns the live health report
 * (DB, auth, email/Resend domain, AI-key validity, integrations) -- no secret
 * values. This is the in-app readout for the new universe + cutover checks.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserTier, getSystemHealth } from "@crucible/core";

export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const tier = await getUserTier(session.user.id);
  if (tier !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const report = await getSystemHealth();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error("Health check error:", err?.message || err);
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
