"use client";

import { useSession } from "next-auth/react";

export type UserTier = "client" | "partner" | "observer" | "admin";

export function useUserTier(): UserTier {
  const { data: session } = useSession();
  return ((session?.user as any)?.tier as UserTier) || "client";
}
