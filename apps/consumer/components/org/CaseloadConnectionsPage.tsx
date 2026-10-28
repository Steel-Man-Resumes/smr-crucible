"use client";
/** /dashboard/connections (staff pass S5): the caseload view, with the viewer's id and send right from the role. */
import { useSession } from "next-auth/react";
import { useEffectiveRole } from "@/components/RoleProvider";
import { CaseloadConnections } from "@/components/org/ConnectionsPanel";

export function CaseloadConnectionsPage() {
  const role = useEffectiveRole();
  const viewerId = (useSession().data?.user as { id?: string } | undefined)?.id ?? null;
  const canSend = !!role?.capabilities?.includes("org.suggest.write");
  return <div className="px-4 py-8"><CaseloadConnections viewerId={viewerId} canSend={canSend} /></div>;
}
