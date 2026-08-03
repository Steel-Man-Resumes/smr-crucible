/**
 * Partner org API -- the staff-hierarchy layer over the consent-gated cohort.
 *
 * GET  -> { org, staff[], cohort } scoped by the caller's role:
 *         owner/org_admin see the whole org (incl. per-client AI cost);
 *         staff see only their assigned clients (no cost column).
 * POST -> admin actions: { action: "assign", clientUserId, staffUserId|null }
 *
 * Consent doctrine unchanged: progress signals only, never content; clients
 * who have not granted 'sharing' are counted but never named.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserTier,
  getOrgContext,
  getOrgStaff,
  getPartnerCohort,
  assignClientStaff,
} from "@crucible/core";

export const maxDuration = 15;

async function resolveContext(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return { error: 401 as const };
  const tier = await getUserTier(session.user.id);
  const { searchParams } = new URL(request.url);
  const overrideCodeId =
    tier === "admin" ? searchParams.get("codeId") || undefined : undefined;
  const org = await getOrgContext(session.user.id, {
    isAdmin: tier === "admin",
    overrideCodeId,
  });
  if (!org) return { error: 403 as const };
  return { org, userId: session.user.id, tier };
}

export async function GET(request: Request) {
  const ctx = await resolveContext(request);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "Not authenticated" : "No org access" },
      { status: ctx.error }
    );
  }
  const { org, userId } = ctx;
  const isOrgAdmin = org.role === "owner" || org.role === "org_admin";

  try {
    const [staff, cohort] = await Promise.all([
      getOrgStaff(org.accessCodeId),
      getPartnerCohort(userId, {
        accessCodeId: org.accessCodeId,
        assignedToStaffId: isOrgAdmin ? undefined : userId,
      }),
    ]);

    // Staff never see the money column -- that is org-admin/owner information.
    const clients = isOrgAdmin
      ? cohort.clients
      : cohort.clients.map((c) => ({ ...c, aiCostUsd: 0 }));

    return NextResponse.json({
      org: {
        name: org.orgName,
        code: org.code,
        logoUrl: org.logoUrl,
        role: org.role,
      },
      staff,
      cohort: { ...cohort, clients },
      canManage: isOrgAdmin,
      showCosts: isOrgAdmin,
    });
  } catch (err: any) {
    console.error("partner org GET failed:", err?.message || err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await resolveContext(request);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "Not authenticated" : "No org access" },
      { status: ctx.error }
    );
  }
  const { org, userId } = ctx;
  if (org.role !== "owner" && org.role !== "org_admin") {
    return NextResponse.json({ error: "Org admins only" }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (body.action === "assign") {
      if (!body.clientUserId) {
        return NextResponse.json({ error: "clientUserId required" }, { status: 400 });
      }
      await assignClientStaff(
        org.accessCodeId,
        body.clientUserId,
        body.staffUserId || null,
        userId
      );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("partner org POST failed:", err?.message || err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
