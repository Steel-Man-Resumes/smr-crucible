/**
 * GET /api/forge/load: the signed-in account's saved Forge run.
 *
 * Answers for the EFFECTIVE account (an admin viewing as someone sees that
 * person's data), and says whose it is: `userId`. The Forge stamps a loaded
 * run as the browser's own only when that id is the browser's own session
 * (components/forge/ForgeImport.tsx; security review 3a Part 2 r1, M3).
 */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { loadForgeProfile } from "@crucible/core";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const profile = await loadForgeProfile(userId);

  if (!profile) {
    return NextResponse.json({ data: null, userId });
  }

  return NextResponse.json({ data: profile, userId });
}
