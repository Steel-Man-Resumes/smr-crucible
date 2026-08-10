/**
 * Partner cohort API -- a monitoring partner sees the consent-shared progress of
 * the clients who redeemed their access codes. Admins see every cohort.
 * GET            -> JSON cohort
 * GET ?format=csv -> CSV download (consent-shared rows only)
 *
 * Authorization is server-side: must be authenticated AND own >=1 access code
 * (or be admin). Progress is consent-gated inside getPartnerCohort.
 */

import { NextResponse } from "next/server";
// effectiveAuth: impersonation-aware, so viewing a partner shows THEIR
// cohort, not the admin's. Read-only enforcement stays at the middleware edge.
import { effectiveAuth as auth } from "@/lib/effective-auth";
import {
  getUserTier,
  isPartnerUser,
  getPartnerCohort,
  cohortToCsv,
  recordDataAccess,
} from "@crucible/core";

export const maxDuration = 15;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const tier = await getUserTier(session.user.id);
  const allowed = await isPartnerUser(session.user.id, tier);
  if (!allowed) {
    return NextResponse.json({ error: "Not a partner" }, { status: 403 });
  }

  const cohort = await getPartnerCohort(session.user.id, { isAdmin: tier === "admin" });

  const { searchParams } = new URL(request.url);
  if (searchParams.get("format") === "csv") {
    const csv = cohortToCsv(cohort);
    const date = new Date().toISOString().slice(0, 10);
    // Audit trail (data_access_log, Phase 1B) -- non-fatal, never blocks the
    // download.
    await recordDataAccess({
      accessorUserId: session.user.id,
      resource: "partner_cohort",
      action: "export_csv",
      context: { clientCount: cohort.clients.length },
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cohort-${date}.csv"`,
      },
    });
  }

  // Audit trail (data_access_log, Phase 1B) -- non-fatal, never blocks the read.
  await recordDataAccess({
    accessorUserId: session.user.id,
    resource: "partner_cohort",
    action: "read",
    context: { clientCount: cohort.clients.length },
  });

  return NextResponse.json(cohort);
}
