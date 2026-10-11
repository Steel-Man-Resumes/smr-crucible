/**
 * GET /api/forge/load: the signed-in account's saved Forge run.
 *
 * Answers for the EFFECTIVE account (an admin viewing as someone sees that
 * person's data), and says whose it is: `userId`. The Forge stamps a loaded
 * run as the browser's own only when that id is the browser's own session
 * (components/forge/ForgeImport.tsx; security review 3a Part 2 r1, M3).
 *
 * `revision` (Phase 5 R1): the newest saved revision of the person's Forge
 * resume (migration 081), so a new browser opens the finish page on that
 * exact version: its text, letter, answers and confirmations. Owner only, and
 * only for the person's own session: none while an admin is viewing as
 * someone (a revision is never read across accounts).
 */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { auth as realAuth } from "@/auth";
import { loadForgeProfile, listArtifacts, getLatestRevision, publicRevision } from "@crucible/core";

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

  let revision = null;
  const real = await realAuth();
  if (real?.user?.id === userId) {
    const forge = (await listArtifacts(userId, { type: "resume", examples: "hide", limit: 50 })).find(
      (a) => (a.target_context as { source?: unknown } | null)?.source === "forge"
    );
    const rev = forge ? await getLatestRevision(userId, forge.id) : null;
    revision = rev ? publicRevision(rev) : null;
  }

  return NextResponse.json({ data: profile, userId, revision });
}
