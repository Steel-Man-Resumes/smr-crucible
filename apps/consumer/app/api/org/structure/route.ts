/**
 * The organization's groups: programs, cohorts, sites, offices, caseloads, and
 * who works in each (migration 103, house lane L3a).
 *
 *   GET  -> { units, members, staff, countsArePartial, ready, canManage, canEnroll }   org.cohort.view
 *   POST { action: create_unit | update_unit | move_unit | close_unit | reopen_unit
 *                  | set_member | remove_member, ... }                               org.settings.manage
 *
 * Units are closed, never deleted. Counts of people are what the viewer can
 * see (the enrollment reach policy). Logic and tests: lib/org-structure-http.ts.
 */
import { requireOrgCapability } from "@/lib/org-guard";
import {
  getOrgStructure, createOrgUnit, updateOrgUnit, moveOrgUnit, setOrgUnitOpen, setUnitMember, removeUnitMember,
} from "@crucible/core";
import { handleStructureGet, handleStructurePost } from "@/lib/org-structure-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  return handleStructureGet(guard.actor, { getOrgStructure });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage", { request });
  if (!guard.ok) return guard.response;
  return handleStructurePost(request, guard.actor, { createOrgUnit, updateOrgUnit, moveOrgUnit, setOrgUnitOpen, setUnitMember, removeUnitMember });
}
