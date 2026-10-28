/**
 * What staff can change for themselves (migration 108), per role and screen.
 *   GET    every policy role's switches, with the words for each, and canManage
 *   PUT { role, surface, allowed }      set switches (a key left out stays as it was)
 *   PUT { role, surface, allowed: null } back to "everything allowed" for that screen
 * Reading needs org.cohort.view; changing needs org.settings.manage (the owner
 * and org admins), checked here, again in core, and by the database policy.
 */
import { NextResponse } from "next/server";
import {
  POLICY_KEYS, POLICY_KEY_TEXT, POLICY_ROLES, POLICY_ROLE_LABELS, POLICY_SURFACES, POLICY_SURFACE_LABELS,
  canManageCustomizationPolicy, getAllCustomizationPolicies, setCustomizationPolicy,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    policies: await getAllCustomizationPolicies(guard.actor),
    roles: POLICY_ROLES.map((r) => ({ key: r, label: POLICY_ROLE_LABELS[r] })),
    surfaces: POLICY_SURFACES.map((s) => ({
      key: s, label: POLICY_SURFACE_LABELS[s],
      switches: POLICY_KEYS[s].map((k) => ({ key: k, ...POLICY_KEY_TEXT[k] })),
    })),
    canManage: canManageCustomizationPolicy(guard.actor),
  });
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const res = await setCustomizationPolicy(guard.actor, body.role, body.surface, body.allowed === null ? null : body.allowed);
  return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
}
