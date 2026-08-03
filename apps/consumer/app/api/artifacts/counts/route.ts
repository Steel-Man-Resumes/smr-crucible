import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getArtifactCounts } from "@crucible/core";

/** GET /api/artifacts/counts — artifact counts grouped by type */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const counts = await getArtifactCounts(userId);
  return NextResponse.json({ data: counts });
}
