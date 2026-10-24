"use client";

import { useSession } from "next-auth/react";
import { useEffectiveRole } from "@/components/RoleProvider";

export type UserTier = "client" | "partner" | "observer" | "admin";

/** Soft self-preview targets (localStorage). Org-leader/staff previews go
 *  through real view-mode impersonation instead -- a soft partner view would
 *  show the wrong org context and mislead. */
export type ViewAs = "client" | "observer";

const VIEW_AS_KEY = "view_as";
const LEGACY_ADMIN_KEY = "admin_test_mode";

/**
 * Roles that may switch into client view: partners with no organization, to
 * see what their clients see. NOT platform admins (B7, 2026-10-23): the soft
 * view drew a job seeker's screens while every save landed in the admin
 * account. Admins use audited impersonation (lib/effective-auth.ts) or a
 * separate job-seeker account instead.
 */
export function canSwitchView(realTier: UserTier): boolean {
  return realTier === "partner";
}

export function getViewAs(): ViewAs | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(VIEW_AS_KEY);
    if (v === "client" || v === "observer") return v;
    // Back-compat with the original admin-only toggle
    if (localStorage.getItem(LEGACY_ADMIN_KEY) === "client") return "client";
  } catch {}
  return null;
}

export function setViewAs(view: ViewAs | null): void {
  try {
    if (view) {
      localStorage.setItem(VIEW_AS_KEY, view);
    } else {
      localStorage.removeItem(VIEW_AS_KEY);
      localStorage.removeItem(LEGACY_ADMIN_KEY);
    }
  } catch {}
}

/**
 * Returns the effective user tier.
 *
 * Resolution order:
 * 1. Active impersonation (RoleProvider, server-resolved): the TARGET's tier,
 *    so nav/landings/pages branch exactly as the target user sees them.
 * 2. view_as soft preview (partners only, canSwitchView): client or observer.
 * 3. The database-resolved tier when loaded, then the session tier.
 * The gates and locks are real in every mode.
 */
export function useUserTier(): UserTier {
  const { data: session } = useSession();
  const effective = useEffectiveRole();
  if (effective?.impersonating) return effective.tier;

  const realTier = effective?.tier || (((session?.user as any)?.tier as UserTier) || "client");
  const viewAs = getViewAs();
  if (canSwitchView(realTier) && viewAs) {
    return viewAs;
  }

  return realTier;
}

/**
 * Always returns the real DB tier of the SIGNED-IN account, ignoring both the
 * view-as override and impersonation. Used by Settings and the banners.
 */
export function useRealTier(): UserTier {
  const { data: session } = useSession();
  const effective = useEffectiveRole();
  if (effective && !effective.impersonating) return effective.tier;
  return ((session?.user as any)?.tier as UserTier) || "client";
}
