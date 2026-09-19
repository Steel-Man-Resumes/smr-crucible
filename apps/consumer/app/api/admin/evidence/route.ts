import { NextResponse } from "next/server";
import { getAggregateReport, getConsentedCaseStudies } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const [report, cases] = await Promise.all([
    getAggregateReport(),
    getConsentedCaseStudies({ limit: 20 }),
  ]);

  return NextResponse.json({ report, cases });
}
