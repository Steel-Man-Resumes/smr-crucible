"use client";

/**
 * RoleProvider -- one fetch, one truth about who the app should behave as.
 *
 * GET /api/user/role resolves the EFFECTIVE identity server-side
 * (effectiveAuth: impersonation cookie honored, org role from org_staff /
 * code ownership). Mounted once in the dashboard layout; useUserTier overlays
 * this during impersonation so nav, landings, and pages all branch as the
 * target user. Normal users: the session tier is authoritative and this just
 * adds orgRole/orgName.
 */

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { UserTier } from "@/lib/useUserTier";

export type OrgRole = "owner" | "org_admin" | "staff" | null;

export interface EffectiveRole {
  tier: UserTier;
  orgRole: OrgRole;
  orgName: string | null;
  impersonating: { mode: "view" | "assist" } | null;
}

const RoleContext = createContext<EffectiveRole | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<EffectiveRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/role")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) setRole(j.data as EffectiveRole);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** Effective role, or null while loading / outside the provider. */
export function useEffectiveRole(): EffectiveRole | null {
  return useContext(RoleContext);
}

/** Org membership shortcut (null orgRole = not part of any org). */
export function useOrgRole(): { orgRole: OrgRole; orgName: string | null } {
  const role = useContext(RoleContext);
  return { orgRole: role?.orgRole ?? null, orgName: role?.orgName ?? null };
}
