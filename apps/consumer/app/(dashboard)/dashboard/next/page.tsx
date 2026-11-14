"use client";

/**
 * What comes next: the last station on the Refinery path. The job is one
 * piece; school, money, health, a ride and an ID hold it up. Each card opens
 * Local help with that kind of help chosen. The place shown is the one Local
 * help will fill in (same order as that page: own Forge run, then account).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { TierGate } from "@/components/TierGate";
import { CrisisLine } from "@/components/CrisisLine";
import { NATIONAL_STARTING_POINTS, NEXT_CATEGORIES, nextCategoryHref } from "@/lib/next-steps";
import { readOwnForgeSession } from "@/lib/forge-carry";
import { savedSearchPlace } from "@/lib/support-deep-link";

function checkedLabel(iso: string, locale = "en"): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale === "es" ? "es" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : iso;
}

function NextPage() {
  const t = useTranslations("refineryHome.next");
  const locale = useLocale();
  const ownerUid = useSession().data?.user?.id;
  const [place, setPlace] = useState("");
  useEffect(() => {
    let live = true;
    if (!ownerUid) return;
    let forgeLocation: string | undefined;
    try {
      const run = readOwnForgeSession(ownerUid) as { preferences?: { location?: string } } | null;
      forgeLocation = run?.preferences?.location;
    } catch {}
    const fromForge = savedSearchPlace(forgeLocation, null);
    if (fromForge) { setPlace(fromForge); return; }
    fetch("/api/user/context", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (live && d) setPlace(savedSearchPlace(null, d.profile));
    }).catch(() => {});
    return () => { live = false; };
  }, [ownerUid]);

  return (
    <div className="max-w-4xl space-y-8">
      <header className="max-w-3xl">
        <p className="font-term text-[10px] font-semibold uppercase tracking-[0.14em] text-t-bone-dim">{t("station")}</p>
        <h1 className="mt-1 text-2xl font-bold text-t-white">{t("title")}</h1>
        <div className="mt-4 border-l-4 border-t-amber bg-t-panel px-4 py-3">
          <p className="text-xs font-semibold text-t-amber-bright">t.ROY</p>
          <p className="mt-1 text-base leading-relaxed text-t-white">
            {t("tip")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-t-phos-dim">
            {t("coverage")}
          </p>
        </div>
      </header>

      <CrisisLine />

      <section aria-labelledby="next-help-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="next-help-heading" className="text-lg font-bold text-t-white">{t("searchHeading")}</h2>
          <p className="text-sm text-t-phos-dim">{place ? t.rich("searchWillUse", { place, strong: (chunks) => <strong className="text-t-white">{chunks}</strong> }) : t("addPlace")}</p>
        </div>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {NEXT_CATEGORIES.map((c) => (
            <li key={c.id}>
              <Link href={nextCategoryHref(c.id)} className="t-focus flex h-full flex-col border border-t-line bg-t-panel p-4 transition-colors hover:border-t-line-strong">
                <strong className="text-base text-t-white">{t(`categories.${c.id}.label`)}</strong>
                <span className="mt-1 text-sm text-t-phos-dim">{t(`categories.${c.id}.line`)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm"><Link href="/dashboard/resources#support" className="t-focus text-t-amber-bright underline underline-offset-2">{t("seeEvery")}</Link></p>
      </section>

      <section aria-labelledby="next-national-heading" className="border-t border-t-line pt-6">
        <h2 id="next-national-heading" className="text-base font-bold text-t-white">{t("nationalHeading")}</h2>
        <p className="mt-1 text-sm text-t-phos-dim">{t("nationalSub")}</p>
        <ul className="mt-3 space-y-2">
          {NATIONAL_STARTING_POINTS.map((p, index) => (
            <li key={p.href} className="text-sm">
              <a href={p.href} target="_blank" rel="noopener noreferrer" className="t-focus inline-flex items-center gap-1 text-t-white underline underline-offset-2">
                {t.has(`national.${index}`) ? t(`national.${index}`) : p.label} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <span className="ml-2 text-xs text-t-bone-dim">{t("checked", { date: checkedLabel(p.checked, locale) })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <TierGate requiredTier="client">
      <NextPage />
    </TierGate>
  );
}
