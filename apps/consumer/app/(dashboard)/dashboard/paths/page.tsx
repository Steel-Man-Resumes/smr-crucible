"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CareerPlanner } from "@/components/paths/CareerPlanner";
import { PathExplorer } from "@/components/paths/PathExplorer";

/**
 * Pick a direction. The career planner comes first (Troy 2026-10-23: people
 * who have no idea what lane they want). The side-by-side comparison stays
 * one tap away for anyone who already has some idea.
 */
export default function PathsPage() {
  const t = useTranslations("refineryJobs.pathsPage");
  const [compare, setCompare] = useState(false);
  return (
    <div className="space-y-10">
      <CareerPlanner />
      <section aria-label={t("compareAria")} className="border-t border-t-line pt-6">
        {compare ? <PathExplorer headingLevel={2} /> : (
          <button type="button" aria-expanded={false} onClick={() => setCompare(true)} className="t-focus inline-flex min-h-touch items-center text-sm font-medium text-t-amber-bright underline underline-offset-2">
            {t("compareButton")}
          </button>
        )}
      </section>
    </div>
  );
}
