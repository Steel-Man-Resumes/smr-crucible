/**
 * The org authorization gate for API routes.
 *
 * ONE function, two lines per route, a discriminated union so TypeScript makes
 * the failure branch impossible to forget:
 *
 *     const guard = await requireOrgCapability("org.client.assign");
 *     if (!guard.ok) return guard.response;
 *     // guard.actor is now a resolved, authorized OrgActor
 *
 * Replaces roughly a dozen inline `tier === "admin"` comparisons scattered
 * across routes, plus two separately duplicated local `requireAdmin()`
 * functions. Scattered string comparisons are not a security model: they drift,
 * they get copied with a typo, and there is no single place to audit them.
 *
 * WHAT THIS DOES NOT DO, deliberately. It answers "may this person do this kind
 * of thing", never "to which rows". Row scope comes from `actor.reach` and, in
 * time, from database policies. Keeping the verb and the rows as separate
 * questions is what stops a guard from quietly becoming the only thing standing
 * between two organizations' data.
 *
 * Hiding a button in the UI is never the control. This is the control.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  resolveOrgActor,
  getUserTier,
  isPlatformAdmin,
  type OrgActor,
  type OrgCapability,
} from "@crucible/core";

export type OrgGuardResult =
  | { ok: true; actor: OrgActor }
  | { ok: false; response: NextResponse };

function fail(status: number, error: string): OrgGuardResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Require `capability` and return the resolved actor.
 *
 * `orgId` is honored ONLY for a platform admin acting deliberately on another
 * organization. For everyone else the org comes from membership, never from the
 * request -- a caller does not get to nominate whose data they are looking at.
 */
export async function requireOrgCapability(
  capability: OrgCapability,
  opts: { orgId?: string } = {}
): Promise<OrgGuardResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail(401, "Not signed in.");

  const tier = await getUserTier(userId);
  const isPlatformAdmin = tier === "admin";

  const actor = await resolveOrgActor(userId, {
    isPlatformAdmin,
    // A non-admin passing an orgId is ignored rather than rejected: they may
    // legitimately be a member of the org they named, and membership decides.
    orgId: opts.orgId,
  });

  if (!actor) return fail(403, "You are not a member of an organization.");

  if (!actor.capabilities.has(capability)) {
    // Deliberately does not name the capability. Telling someone exactly which
    // permission they lack tells them the shape of the permission system.
    return fail(403, "You do not have access to that.");
  }

  return { ok: true, actor };
}

/**
 * Platform-admin gate, for the handful of routes that are genuinely about the
 * platform rather than an org: health, minting codes, cost reporting.
 *
 * This is the ONE place tier is still read as an authorization signal, and it
 * is narrow on purpose. Every org-scoped decision goes through
 * requireOrgCapability instead.
 */
export async function requirePlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return fail(401, "Not signed in.") as { ok: false; response: NextResponse };

  // platform_admin, not users.tier: the application role cannot write that
  // table, so no code path here -- a tier sync, a redeemed code, a bug -- can
  // make an administrator. See migration 047.
  if (!(await isPlatformAdmin(userId))) {
    return fail(403, "You do not have access to that.") as {
      ok: false;
      response: NextResponse;
    };
  }
  return { ok: true, userId };
}
