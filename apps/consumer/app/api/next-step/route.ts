/**
 * GET /api/next-step -- the single most valuable next action for the user.
 *
 * Thin wrapper over getNextStep() (packages/core). Cache-aware (1h) with
 * server-side recompute + persist. Auth required.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getNextStep } from "@crucible/core";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const next = await getNextStep(userId);
    return NextResponse.json({ data: next });
  } catch (err) {
    console.error("[next-step] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not compute next step" }, { status: 500 });
  }
}
