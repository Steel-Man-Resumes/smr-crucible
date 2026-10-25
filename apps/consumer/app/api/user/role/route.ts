/**
 * GET /api/user/role -- the effective identity, resolved server-side.
 *
 * Returns { tier, orgRole, orgName, orgId, orgBrand, coBrand, impersonating } for the user the app
 * should BEHAVE as: effectiveAuth resolves the impersonation cookie (admin
 * only, self-guarding), getOrgContext resolves org membership (code owner or
 * org_staff row). Feeds RoleProvider so landings and nav branch correctly
 * for org leaders, staff, and impersonation sessions.
 */

import { NextResponse } from "next/server";
import { effectiveAuth } from "@/lib/effective-auth";
import { roleBrandFields } from "@/lib/org-brand-http";

export const maxDuration = 10;

export async function GET() {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { getUserTier, getOrgContext, resolveOrgActor } = await import(
    "@crucible/core"
  );
  const tier = await getUserTier(userId);

  // Org context only matters for partner/admin tiers; skip the lookups otherwise.
  const org =
    tier === "partner" || tier === "admin"
      ? await getOrgContext(userId).catch(() => null)
      : null;

  // The real capability set, so the UI can mirror the authorization model
  // instead of inferring permissions from a tier rank. Three separate rank
  // tables currently disagree with each other; this is what replaces them.
  const actor = org ? await resolveOrgActor(userId).catch(() => null) : null;

  // Is the per-participant workspace switched on for this organization? The
  // shell uses it to choose which staff navigation to show.
  const flag = actor
    ? await (await import("@crucible/core"))
        .getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [actor.orgId])
        .catch(() => null)
    : null;

  // Brand fields (lib/org-brand-http.ts roleBrandFields, tested there):
  // staff get orgId and orgBrand for the identity block and never coBrand;
  // participants get coBrand (no tier) or null; solo users get nothing.
  const core = await import("@crucible/core");
  const { orgId, orgBrand, coBrand } = await roleBrandFields(
    { userId, orgId: actor?.orgId ?? org?.accessCodeId ?? null, hasOrgRole: !!org },
    { getOrgBrand: core.getOrgBrand, getParticipantCoBrand: core.getParticipantCoBrand }
  );

  const impersonation = (session as { impersonation?: { mode: "view" | "assist"; adminId: string } })
    .impersonation;

  return NextResponse.json({
    data: {
      accountId: userId,
      sessionAccountId: impersonation?.adminId ?? userId,
      tier,
      orgRole: org?.role ?? null,
      orgName: org?.orgName ?? null,
      orgId,
      orgBrand,
      coBrand,
      capabilities: actor ? Array.from(actor.capabilities) : [],
      cohortReach: actor?.reach ?? "none",
      crmV2: !!flag?.crm_v2,
      impersonating: impersonation ? { mode: impersonation.mode } : null,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
