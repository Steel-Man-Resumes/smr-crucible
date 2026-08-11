/**
 * GET /api/user/decisions -- the signed-in user's OWN t.ROY decision log.
 *
 * Powers the "Why t.ROY suggested things" viewer. Ownership-scoped: only the
 * caller's own rows, via getUserDecisions(userId).
 *
 * We return the recorded reasoning only: the plain explanation, when, and which
 * model. We NEVER return the raw input (only a one-way hash of it is stored) and
 * we do not expose any chain-of-thought (none is stored). This is honest
 * transparency, not more than exists.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getUserDecisions } from "@crucible/core";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25)
  );

  try {
    const rows = await getUserDecisions(session.user.id, limit);
    const decisions = rows.map((d) => ({
      contextPage: d.context_page,
      explanation: d.explanation,
      modelProvider: d.model_provider,
      modelId: d.model_id,
      outputSummary: d.output_summary ?? {},
      createdAt: d.ts,
    }));
    return NextResponse.json({ decisions });
  } catch (err: any) {
    console.error("user decisions query failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
