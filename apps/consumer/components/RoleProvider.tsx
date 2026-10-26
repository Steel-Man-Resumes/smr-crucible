"use client";

/**
 * RoleProvider -- resolve the effective role for each signed-in account.
 *
 * GET /api/user/role resolves the EFFECTIVE identity server-side
 * (effectiveAuth: impersonation cookie honored, org role from org_staff /
 * code ownership). Mounted once in the dashboard layout; useUserTier overlays
 * this during impersonation so nav, landings, and pages all branch as the
 * target user. Account changes immediately hide the previous role while the
 * new account is resolved.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import type { UserTier } from "@/lib/useUserTier";
import type { OrgBrand } from "@crucible/core/src/orgBrandShared";
import { resolveWorkspace, type Workspace } from "@/lib/workspace";

export type OrgRole = "owner" | "org_admin" | "staff" | null;

export interface EffectiveRole {
  /** Effective data owner, distinct from the signed-in actor during impersonation. */
  accountId: string;
  sessionAccountId: string;
  tier: UserTier;
  /**
   * The workspace to show (lib/workspace.ts resolveWorkspace): admin, staff,
   * participant. From the org role, never from tier. Optional only so an old
   * response shape still type-checks; the route always sends it.
   */
  workspace?: Workspace;
  orgRole: OrgRole;
  orgName: string | null;
  /** The organization this staff member works in (access_code id). Null for participants and solo users. */
  orgId?: string | null;
  /** That organization's brand: logo present, branding tier. Never bytes, never a URL. */
  orgBrand?: OrgBrand | null;
  /**
   * PARTICIPANTS ONLY: the organization shown beside Steel Man in the top bar.
   * Set only for a member of an organization on the co-brand or full tier.
   * Null for staff, solo participants and everyone else, who see no org mark.
   */
  coBrand?: { orgId: string; name: string; hasLogo: boolean } | null;
  /** The per-participant staff workspace is on for this person's organization. */
  crmV2?: boolean;
  capabilities?: string[];
  impersonating: { mode: "view" | "assist" } | null;
}

const RoleContext = createContext<EffectiveRole | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const sessionAccountId = status === "authenticated" ? session?.user?.id ?? null : null;
  const [attempt, setAttempt] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ sessionAccountId: string; role: EffectiveRole } | null>(null);

  useEffect(() => {
    setSnapshot(null); setFailedFor(null);
    if (!sessionAccountId) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => { if (active) setFailedFor(sessionAccountId); controller.abort(); }, 10000);
    fetch("/api/user/role", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const role = result?.data as EffectiveRole | undefined;
        if (controller.signal.aborted || !role || role.sessionAccountId !== sessionAccountId ||
            typeof role.accountId !== "string" || !role.accountId ||
            (!role.impersonating && role.accountId !== sessionAccountId)) { if (active && !controller.signal.aborted) setFailedFor(sessionAccountId); return; }
        setSnapshot({ sessionAccountId, role });
      })
      .catch(() => { if (active) setFailedFor(sessionAccountId); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [sessionAccountId, attempt]);

  // Mask during render: an effect alone leaves one render of the previous role.
  const role = sessionAccountId && snapshot?.sessionAccountId === sessionAccountId ? snapshot.role : null;
  return <RoleContext.Provider value={role}>{failedFor && failedFor === sessionAccountId && <div role="alert" className="border border-t-line bg-t-bg p-4 text-t-white">Your account could not be loaded. <button className="min-h-touch underline" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}{children}</RoleContext.Provider>;
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

/**
 * The workspace for the effective account: the route's answer, or the same
 * rule computed here from the role when an older response has none. "none"
 * while loading.
 */
export function useWorkspace(): Workspace {
  const role = useContext(RoleContext);
  if (!role) return "none";
  return role.workspace ?? resolveWorkspace(
    { userId: role.accountId, tier: role.tier, impersonating: role.impersonating },
    { orgRole: role.orgRole }
  );
}
