"use client";

/**
 * /dashboard/partner -- thin wrapper around OrgDashboard.
 *
 * Org leaders and staff also get OrgDashboard as their /dashboard landing
 * (role-clear wave); this route stays as the direct link and as the admin
 * org override target (?codeId=<access_code_id> shows that org's view).
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { OrgDashboard } from "@/components/org/OrgDashboard";

export default function PartnerDashboardPage() {
  return (
    <Suspense>
      <PartnerDashboardInner />
    </Suspense>
  );
}

function PartnerDashboardInner() {
  const searchParams = useSearchParams();
  // Admin org override: /dashboard/partner?codeId=... shows that org's view
  const codeId = searchParams.get("codeId") || "";
  return <OrgDashboard codeId={codeId} />;
}
