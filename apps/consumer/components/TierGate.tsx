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
    <div className="border border-dashed border-t-line p-8 text-center font-term">
      <p className="text-lg font-semibold text-t-white mb-2">
        Full access requires a partner code
      </p>
      <p className="text-sm text-t-phos-dim mb-4">
        This tool is available to clients and partners. Try The Forge first — it&apos;s free and shows you what we do.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href="https://forge.steelmanresumes.com"
          className="t-focus px-6 py-3 bg-t-amber text-[#14100a] font-bold shadow-[3px_3px_0_#000] hover:bg-t-amber-bright transition-colors"
        >
          Try The Forge
        </a>
        <a
          href="/dashboard/settings"
          className="t-focus px-6 py-3 bg-transparent text-t-amber-bright border border-t-amber font-bold hover:bg-t-amber/10 transition-colors"
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
