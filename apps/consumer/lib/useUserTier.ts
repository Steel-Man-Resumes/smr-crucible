"use client";

import { useSession } from "next-auth/react";

export type UserTier = "client" | "partner" | "observer" | "admin";

/**
 * Returns the effective user tier.
 * Admin users can toggle "Test as Client" mode via localStorage
 * to experience the app as a regular user without losing admin DB tier.
 */
export function useUserTier(): UserTier {
  const { data: session } = useSession();
  const realTier = ((session?.user as any)?.tier as UserTier) || "client";

  // Admin test mode override (localStorage-only, doesn't touch DB)
  if (realTier === "admin" && typeof window !== "undefined") {
    try {
      const override = localStorage.getItem("admin_test_mode");
      if (override === "client") return "client";
    } catch {}
  }

  return realTier;
}

/**
 * Always returns the real DB tier, ignoring test mode override.
 * Used by Settings page to show the admin toggle.
 */
export function useRealTier(): UserTier {
  const { data: session } = useSession();
  return ((session?.user as any)?.tier as UserTier) || "client";
}
