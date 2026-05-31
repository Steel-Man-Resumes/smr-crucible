/**
 * Mini Forge import-complete.
 * Reached after successful sign-in following a mini-forge import.
 *
 * Reads the mf_session cookie (set by /mini-forge/import before auth),
 * copies forge_output from tablet_session → consumer_profile via saveForgeSession,
 * clears the cookie, redirects to /dashboard?welcome=mini-forge.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getTabletSessionForImport, TABLET_COOKIE } from "@/lib/tablet-session";
import { saveForgeSession } from "@crucible/core";

export default async function ImportCompletePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/mini-forge/import-complete");
  }

  const cookieStore = cookies();
  const tabletSessionId = cookieStore.get(TABLET_COOKIE)?.value;

  if (!tabletSessionId) {
    // No cookie -- user may have already completed the import or came here directly.
    redirect("/dashboard");
  }

  const tabletSession = await getTabletSessionForImport(tabletSessionId);

  if (!tabletSession || !tabletSession.forge_output) {
    // Session expired, not found, or AI never finished -- skip seeding.
    cookieStore.delete(TABLET_COOKIE);
    redirect("/dashboard");
  }

  const intake = tabletSession.forge_intake as Record<string, unknown>;
  const output = tabletSession.forge_output as Record<string, unknown>;

  // Seed the Refinery profile with Mini Forge data.
  // Uses the same saveForgeSession contract as the full Forge.
  await saveForgeSession(session.user.id, `mini-forge-${tabletSession.id}`, {
    readinessStage: intake.readiness_stage as string | undefined,
    goals: intake.goals as string[] | undefined,
    challenges: intake.challenges as string[] | undefined,
    preferences: intake.work_type
      ? { work_type: intake.work_type as string }
      : undefined,
    forgeOutput: output,
    pagesVisited: ["mini-forge-intake"],
    startedAt: tabletSession.created_at?.toString(),
  });

  // Clear the mini-forge cookie now that import is done.
  cookieStore.delete(TABLET_COOKIE);

  redirect("/dashboard?welcome=mini-forge");
}
