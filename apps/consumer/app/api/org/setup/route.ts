/**
 * Finish the setup wizard (migration 103, house lane L3a): the organization's
 * type, words and modules, marked complete, and its starting groups, in one
 * transaction. Groups are created only while the organization has none.
 *
 *   POST { orgType, displayName?, timezone?, terms?, modules?, units? }   org.settings.manage
 */
import { requireOrgCapability } from "@/lib/org-guard";
import { completeOrgSetup } from "@crucible/core";
import { handleSetupPost } from "@/lib/org-structure-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage", { request });
  if (!guard.ok) return guard.response;
  return handleSetupPost(request, guard.actor, { completeOrgSetup });
}
