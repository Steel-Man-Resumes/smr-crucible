"use client";

/**
 * The quiet notice for people who use the Forge today, shown on the public
 * Forge pages while the sign-in date is set and still ahead (lib/forge-access.ts).
 * Shows nothing when no date is set: a date is never made up.
 */

import { Info } from "lucide-react";
import { forgeWallNotice } from "@/lib/forge-access";
import { useForgeWall } from "./useForgeWall";

export function SignInNotice() {
  const wall = useForgeWall();
  const text = wall ? forgeWallNotice(wall) : null;
  if (!text) return null;
  return (
    <div className="border-b border-t-line bg-t-panel" data-testid="forge-sign-in-notice">
      <p className="mx-auto flex max-w-[1440px] items-start gap-2 px-4 py-2 text-sm text-t-bone-dim sm:px-6">
        <Info size={16} aria-hidden="true" className="mt-0.5 flex-none text-t-amber-bright" />
        <span>{text}</span>
      </p>
    </div>
  );
}
