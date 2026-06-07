/**
 * Verified fair-chance employers for the board. Published rows only; job-seeker
 * fields only (no contact/outreach intel). Auth required (client+).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listPublishedEmployers } from "@crucible/core";

export const maxDuration = 10;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const industry = searchParams.get("industry") || undefined;
  const employers = await listPublishedEmployers({ industry, limit: 200 });
  return NextResponse.json({ employers });
}
