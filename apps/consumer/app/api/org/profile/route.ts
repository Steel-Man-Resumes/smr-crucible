/**
 * The organization's profile: its type, its own words, its modules, and
 * whether setup is finished (migration 103, house lane L3a).
 *
 *   GET   -> { profile, canManage, needsSetup }   anyone on staff (org.cohort.view)
 *   PATCH -> change type, name, time zone, words, modules   org.settings.manage
 *
 * A platform admin acting for an organization reads and never writes. The
 * 103 policies refuse anyone but the owner or an org admin; this check is the
 * friendly answer. Logic and tests: lib/org-structure-http.ts.
 */
import { requireOrgCapability } from "@/lib/org-guard";
import { getOrgProfile, updateOrgProfile } from "@crucible/core";
import { handleProfileGet, handleProfilePatch } from "@/lib/org-structure-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  return handleProfileGet(guard.actor, { getOrgProfile });
}

export async function PATCH(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard.response;
  return handleProfilePatch(request, guard.actor, { updateOrgProfile });
}
