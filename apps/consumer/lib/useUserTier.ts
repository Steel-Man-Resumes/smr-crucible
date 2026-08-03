"use client";

import { useSession } from "next-auth/react";

export type UserTier = "client" | "partner" | "observer" | "admin";

const VIEW_AS_KEY = "view_as";
const LEGACY_ADMIN_KEY = "admin_test_mode";

/** Roles that may switch into client view (Troy C7: operate as a user). */
export function canSwitchView(realTier: UserTier): boolean {
  return realTier === "admin" || realTier === "partner";
}

export function getViewAs(): "client" | null {
  if (typeof window === "undefined") return null;
  try {
    if (localStorage.getItem(VIEW_AS_KEY) === "client") return "client";
    // Back-compat with the original admin-only toggle
    if (localStorage.getItem(LEGACY_ADMIN_KEY) === "client") return "client";
  } catch {}
  return null;
}

export function setViewAs(view: "client" | null): void {
  try {
    if (view === "client") {
      localStorage.setItem(VIEW_AS_KEY, "client");
    } else {
      localStorage.removeItem(VIEW_AS_KEY);
      localStorage.removeItem(LEGACY_ADMIN_KEY);
    }
  } catch {}
}

/**
 * Returns the effective user tier.
 * Admin AND partner users can toggle client view via localStorage to
 * experience the app exactly as a client, without touching their DB tier.
 * The gates and locks are real in client view.
 */
export function useUserTier(): UserTier {
  const { data: session } = useSession();
  const realTier = ((session?.user as any)?.tier as UserTier) || "client";

  if (canSwitchView(realTier) && getViewAs() === "client") {
    return "client";
  }

  return realTier;
}

/**
 * Always returns the real DB tier, ignoring the view-as override.
 * Used by Settings and the view-as banner/toggle.
 */
export function useRealTier(): UserTier {
  const { data: session } = useSession();
  return ((session?.user as any)?.tier as UserTier) || "client";
}
