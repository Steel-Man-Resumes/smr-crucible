import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserTier, getAggregateReport, getConsentedCaseStudies } from "@crucible/core";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tier = await getUserTier(session.user.id);
  if (tier !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const [report, cases] = await Promise.all([
    getAggregateReport(),
    getConsentedCaseStudies({ limit: 20 }),
  ]);

  return NextResponse.json({ report, cases });
}
