"use client";

import type { ReactNode } from "react";
import { useUserTier, type UserTier } from "@/lib/useUserTier";

const TIER_RANK: Record<string, number> = {
  admin: 0,
  partner: 1,
  client: 2,
  observer: 3,
};

interface TierGateProps {
  /** Minimum tier required to see full content */
  requiredTier: UserTier;
  children: ReactNode;
  /** What to show if user doesn't meet the tier. Defaults to observer fallback. */
  fallback?: ReactNode;
}

function DefaultFallback() {
  return (
    <div className="rounded-xl border-2 border-dashed border-border p-8 text-center">
      <p className="text-lg font-semibold text-foreground mb-2">
        Full access requires a partner code
      </p>
      <p className="text-sm text-muted mb-4">
        This tool is available to clients and partners. Try The Forge first — it&apos;s free and shows you what we do.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="https://forge.steelmanresumes.com"
          className="px-6 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors"
        >
          Try The Forge
        </a>
        <a
          href="/dashboard/settings"
          className="px-6 py-3 bg-white text-sage-600 border-2 border-sage-200 rounded-xl font-medium hover:bg-sage-50 transition-colors"
        >
          Enter a Partner Code
        </a>
      </div>
    </div>
  );
}

export function TierGate({ requiredTier, children, fallback }: TierGateProps) {
  const userTier = useUserTier();
  const userRank = TIER_RANK[userTier] ?? 3;
  const requiredRank = TIER_RANK[requiredTier] ?? 3;

  if (userRank <= requiredRank) {
    return <>{children}</>;
  }

  return <>{fallback || <DefaultFallback />}</>;
}
