"use client";

/**
 * No page was brought in (the person typed their jobs), so there is no
 * "before" to mark up. Show the jobs they entered, as they entered them.
 */

import { useTranslations } from "next-intl";
import type { JobCard } from "@/lib/showstopper-tour";

export function JobCards({ jobs }: { jobs: JobCard[] }) {
  const t = useTranslations("forgeProcessing");
  // The dates arrive from lib/showstopper-tour.ts with two English words in
  // them ("about 2019", "- Present"); say them in the site language here.
  const datesText = (d: string) =>
    d
      .replace(/\babout (\d+)\b/g, (_, year: string) => t("jobs.about", { year }))
      .replace(/ - Present$/, ` - ${t("jobs.present")}`);
  return (
    <section aria-label={t("jobs.aria")} className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
      <h2 className="mb-2 font-term text-xs uppercase tracking-wider text-t-amber-bright">{t("jobs.heading")}</h2>
      <ul className="space-y-2">
        {jobs.map((j, i) => (
          <li key={i} className="border border-t-line bg-t-panel px-4 py-3">
            <p className="text-base font-semibold text-t-white">{j.title || j.company}</p>
            {j.title && j.company && <p className="text-sm text-t-bone-dim">{j.company}</p>}
            <p className="mt-1 font-term text-xs text-t-bone-dim">{j.dates ? datesText(j.dates) : t("jobs.noDates")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
