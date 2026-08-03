/**
 * GET /api/user/role -- the effective identity, resolved server-side.
 *
 * Returns { tier, orgRole, orgName, impersonating } for the user the app
 * should BEHAVE as: effectiveAuth resolves the impersonation cookie (admin
 * only, self-guarding), getOrgContext resolves org membership (code owner or
 * org_staff row). Feeds RoleProvider so landings and nav branch correctly
 * for org leaders, staff, and impersonation sessions.
 */

import { NextResponse } from "next/server";
import { effectiveAuth } from "@/lib/effective-auth";

export const maxDuration = 10;

export async function GET() {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { getUserTier, getOrgContext } = await import("@crucible/core");
  const tier = await getUserTier(userId);

  // Org context only matters for partner/admin tiers; skip the lookups otherwise.
  const org =
    tier === "partner" || tier === "admin"
      ? await getOrgContext(userId).catch(() => null)
      : null;

  const impersonation = (session as { impersonation?: { mode: "view" | "assist" } })
    .impersonation;

  return NextResponse.json({
    data: {
      tier,
      orgRole: org?.role ?? null,
      orgName: org?.orgName ?? null,
      impersonating: impersonation ? { mode: impersonation.mode } : null,
    },
  });
}
