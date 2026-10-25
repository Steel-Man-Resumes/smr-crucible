"use client";

/**
 * /dashboard/people -- the caseload (CRM wave 2026-10-25). Was the /dashboard
 * landing; workspace staff now land on Today and reach everyone here. Old
 * /dashboard#anchor links are forwarded here by the /dashboard doorway.
 */
import { OrgDashboard } from "@/components/org/OrgDashboard";

export default function PeoplePage() {
  return <OrgDashboard />;
}
