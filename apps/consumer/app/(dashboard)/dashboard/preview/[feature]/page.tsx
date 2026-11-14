"use client";

/**
 * Feature preview (Phase 4.1) -- what a locked tool does, before you unlock it.
 *
 * Every locked client tool routes here instead of a dead end. This page is
 * PURELY informational: it shows what the tool does, an obviously-fake "Sample"
 * of its output, a small real taste (a sample question / script), and the
 * CORRECT current unlock path (read live from the server gate decision). It
 * never renders the real tool and never bypasses the gate -- the real tool page
 * keeps its own OnboardingGate at action depth.
 *
 * If the user is already unlocked for this tool, we say so and link straight in.
 */

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOnboarding } from "@/lib/useOnboarding";
import { getFeaturePreview } from "@/lib/featurePreviews";
import { GATE_STATE_RANK } from "@crucible/core/src/gateRank";

export default function FeaturePreviewPage() {
  const t = useTranslations("refineryResume.preview");
  const params = useParams<{ feature: string }>();
  const feature = getFeaturePreview(params?.feature);
  const { state, gate } = useOnboarding();

  if (!feature) return notFound();

  // Already unlocked for this tool? (loading counts as "not yet" -- stay honest.)
  const alreadyUnlocked =
    state !== "loading" && GATE_STATE_RANK[state] <= GATE_STATE_RANK[feature.requiredState];

  // The correct current unlock path comes from the server gate decision. If the
  // gate hasn't answered yet, fall back to the tailor step (the common unlock).
  const unlock = gate?.unlockAction ?? { label: t("fallbackUnlock"), href: "/dashboard/application-tailor" };
  const unlockIsExternal = unlock.href.startsWith("http");

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <p className="text-xs font-medium uppercase text-t-phos-dim mb-1">{t("kicker")}</p>
        <h1 className="text-2xl font-bold text-t-white">{feature.title}</h1>
      </div>

      {/* What it does */}
      <section className="border border-t-line bg-t-panel p-5">
        <h2 className="text-sm font-bold text-t-white mb-2">{t("whatItDoes")}</h2>
        <p className="text-sm text-t-phos-dim leading-relaxed">{feature.whatItDoes}</p>
      </section>

      {/* Sample output -- obviously fake, labeled Sample */}
      <section className="border border-t-line bg-t-panel-2 p-5">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-bold text-t-white">{t("example")}</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide text-t-amber-bright border border-t-amber px-1.5 py-0.5">
            {t("sample")}
          </span>
        </div>
        <p className="text-sm text-t-phos-dim leading-relaxed">{feature.sampleOutput}</p>
      </section>

      {/* Trial taste */}
      <section className="border border-t-amber bg-t-panel p-5">
        <h2 className="text-sm font-bold text-t-amber-bright mb-2">{t("taste")}</h2>
        <p className="text-sm text-t-phos leading-relaxed">{feature.trialTaste}</p>
      </section>

      {/* Unlock path + actions */}
      <section className="border border-t-line bg-t-panel p-5">
        {alreadyUnlocked ? (
          <>
            <p className="text-sm text-t-phos-dim mb-4 leading-relaxed">
              {t("unlocked")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={feature.href}
                className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright transition-colors text-center"
              >
                {t("open", { title: feature.title })}
              </Link>
              <Link
                href="/dashboard"
                className="t-focus px-6 py-3 bg-transparent text-t-amber-bright border border-t-amber font-bold hover:bg-t-amber/10 transition-colors text-center"
              >
                {t("back")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold text-t-white mb-2">{t("howTitle")}</h2>
            <p className="text-sm text-t-phos-dim mb-4 leading-relaxed">
              {gate?.reason ??
                t("fallbackReason")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              {unlockIsExternal ? (
                <a
                  href={unlock.href}
                  className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright transition-colors text-center"
                >
                  {unlock.label}
                </a>
              ) : (
                <Link
                  href={unlock.href}
                  className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright transition-colors text-center"
                >
                  {unlock.label}
                </Link>
              )}
              <Link
                href="/dashboard"
                className="t-focus px-6 py-3 bg-transparent text-t-amber-bright border border-t-amber font-bold hover:bg-t-amber/10 transition-colors text-center"
              >
                {t("back")}
              </Link>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
