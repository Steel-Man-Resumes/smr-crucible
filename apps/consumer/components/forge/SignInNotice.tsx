"use client";

/**
 * The quiet notice for people who use the Forge today, shown on the public
 * Forge pages while the sign-in date is set and still ahead (lib/forge-access.ts).
 * Shows nothing when no date is set: a date is never made up.
 */

import { Info } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { FORGE_SIGN_IN_STARTS_AT, forgeWallNotice } from "@/lib/forge-access";
import { useForgeWall } from "./useForgeWall";

export function SignInNotice() {
  const t = useTranslations("ui.signInNotice");
  const format = useFormatter();
  const wall = useForgeWall();
  // forgeWallNotice stays the gate (null = nothing to show, never a made-up
  // date); the sentence and the date wording come from the catalog and Intl.
  const gate = wall ? forgeWallNotice(wall) : null;
  if (!gate) return null;
  // The owner-typed date, read the same way forgeWallDateLabel reads it (no time zone shift).
  const [, month, day] = (FORGE_SIGN_IN_STARTS_AT as string).trim().slice(0, 10).split("-").map(Number);
  const date = format.dateTime(new Date(Date.UTC(2000, month - 1, day)), { month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <div className="border-b border-t-line bg-t-panel" data-testid="forge-sign-in-notice">
      <p className="mx-auto flex max-w-[1440px] items-start gap-2 px-4 py-2 text-sm text-t-bone-dim sm:px-6">
        <Info size={16} aria-hidden="true" className="mt-0.5 flex-none text-t-amber-bright" />
        <span>{t("notice", { date })}</span>
      </p>
    </div>
  );
}
