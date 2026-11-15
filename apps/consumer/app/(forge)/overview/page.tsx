"use client";

/**
 * Observer Path -- Deep-Dive Tour
 *
 * Audience: scholars, funders, researchers, developers, partner organizations.
 * This is open-source software built for transparency. Nothing is hidden.
 * The full architecture, research foundation, behavioral protocol, and
 * privacy model are documented here -- no sign-in required.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";
import { TBtn } from "@crucible/consumer-ui";
import { useTranslations } from "next-intl";

const STAT_VALUES = ["70M+", "<50%", "$7,500", "0"];

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const JOURNEY_COLORS = ["amber", "phos", "steel", "amber", "phos", "steel"];

const BADGE_COLOR: Record<string, string> = {
  amber: "border-t-amber text-t-amber-bright",
  phos: "border-t-phos text-t-phos",
  steel: "border-t-steel text-t-steel",
};

export default function OverviewPage() {
  const t = useTranslations("refineryShell.overview");
  const router = useRouter();
  const { updateSession } = useForgeSession();

  useEffect(() => {
    updateSession({
      pagesVisited: ["intro", "overview"],
      lastPageVisited: "overview",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-t-bg">
      <div className="max-w-2xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-medium text-t-amber-bright mb-3 uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="text-3xl font-bold text-t-white mb-4 leading-tight">
            {t("title")}
          </h1>
          <p className="text-lg text-t-phos leading-relaxed mb-4">
            {t("lead")}
          </p>
          <p className="text-sm text-t-phos-dim leading-relaxed">
            {t("lead2")}
          </p>
        </div>

        {/* The numbers */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-5">{t("gapTitle")}</h2>
          <div className="grid grid-cols-2 gap-4">
            {STAT_VALUES.map((value, i) => (
              <div
                key={i}
                className={`p-5 border ${
                  i === 3
                    ? "col-span-2 bg-t-panel-2 border-t-amber"
                    : "bg-t-panel border-t-line"
                }`}
              >
                <p className="text-2xl font-bold mb-1 text-t-amber-bright">
                  {value}
                </p>
                <p className="text-sm leading-snug text-t-phos-dim">
                  {t(`stats.s${i}`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* The full journey */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">{t("journeyTitle")}</h2>
          <p className="text-sm text-t-phos-dim mb-5">
            {t("journeyLead")}
          </p>
          <div className="space-y-4">
            {range(6).map((i) => (
              <div key={i} className="p-5 border border-t-line bg-t-panel">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 border ${BADGE_COLOR[JOURNEY_COLORS[i]]}`}>
                    {t("journeyStage", { n: i + 1 })}
                  </span>
                  <span className="text-xs text-t-phos-dim">{t(`journey.j${i}.time`)}</span>
                </div>
                <h3 className="font-bold text-t-white mb-1">{t(`journey.j${i}.name`)}</h3>
                <p className="text-sm text-t-phos leading-relaxed mb-3">{t(`journey.j${i}.what`)}</p>
                <div className="bg-t-bg/60 p-3 border border-t-line">
                  <p className="text-xs text-t-phos-dim leading-relaxed">
                    <span className="font-semibold text-t-white">{t("underHood")} </span>
                    {t(`journey.j${i}.tech`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* t.ROY behavioral protocol */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("protocolTitle")}
          </h2>
          <p className="text-sm text-t-phos-dim mb-5">
            {t("protocolLead")}
          </p>
          <div className="space-y-3">
            {range(10).map((i) => (
              <div key={i} className="border border-t-line p-4">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-t-panel-2 border border-t-line text-t-amber-bright text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-t-white text-sm mb-1">{t(`rules.r${i}.rule`)}</p>
                    <p className="text-xs text-t-phos-dim leading-relaxed">{t(`rules.r${i}.why`)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What makes it different */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-5">
            {t("differentTitle")}
          </h2>
          <div className="space-y-3">
            {range(7).map((i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 bg-t-panel-2 border border-t-line flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="#c9973f"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-t-white">{t(`different.d${i}.us`)}</p>
                  <p className="text-xs text-t-phos-dim mt-0.5">{t("versus", { them: t(`different.d${i}.them`) })}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy model */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("privacyTitle")}
          </h2>
          <p className="text-base text-t-phos leading-relaxed mb-4">
            {t("privacyLead")}
          </p>
          <div className="space-y-3">
            {range(5).map((i) => (
              <div key={i} className="border border-t-line p-4">
                <p className="font-semibold text-t-white text-sm mb-1">{t(`privacy.p${i}.title`)}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{t(`privacy.p${i}.detail`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Research */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("researchTitle")}
          </h2>
          <p className="text-sm text-t-phos-dim mb-5">
            {t("researchLead")}
          </p>
          <div className="space-y-4">
            {range(6).map((i) => (
              <div key={i} className="border border-t-line p-5">
                <p className="font-semibold text-t-white text-sm mb-1">{t(`research.c${i}.finding`)}</p>
                <p className="text-xs text-t-amber-bright font-medium mb-2">{t(`research.c${i}.source`)}</p>
                <p className="text-sm text-t-phos-dim leading-relaxed">{t(`research.c${i}.detail`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("archTitle")}
          </h2>
          <p className="text-base text-t-phos leading-relaxed mb-4">
            {t("archLead")}
          </p>
          <div className="bg-t-panel-2 px-5 py-4 text-xs text-t-phos-dim border border-t-line mb-4">
            <p className="text-t-phos-dim/70 mb-2">{t("archLog")}</p>
            <p>decision_log &#123;</p>
            <p className="pl-4">input_hash: &quot;h1:&quot; + hmac_sha256(server_secret, &quot;decision|&quot; + user_input)[0:32]</p>
            <p className="pl-4">model_id: &quot;claude-sonnet-5-5&quot;</p>
            <p className="pl-4">explanation: &quot;why this recommendation&quot;</p>
            <p className="pl-4">latency_ms: 1247</p>
            <p className="pl-4">user_action: null | &quot;accepted&quot; | &quot;modified&quot;</p>
            <p>&#125;</p>
          </div>
          <div className="space-y-3 text-sm">
            {range(5).map((i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-t-amber flex-shrink-0 text-xs mt-0.5">&rsaquo;</span>
                <p className="text-t-phos-dim leading-relaxed">{t(`arch.a${i}`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* For partners */}
        <section className="mb-12 border border-t-line p-6">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("partnersTitle")}
          </h2>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
            {t("partnersLead")}
          </p>
          <div className="space-y-3 text-sm">
            {range(4).map((i) => (
              <div key={i} className="border border-t-line p-4">
                <p className="font-semibold text-t-white mb-1">{t(`partners.n${i}.label`)}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{t(`partners.n${i}.detail`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* For funders */}
        <section className="mb-12 border border-t-line p-6 bg-t-panel">
          <h2 className="text-xl font-bold text-t-white mb-2">
            {t("fundersTitle")}
          </h2>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
            {t("fundersLead")}
          </p>
          <div className="space-y-3 text-sm">
            {range(4).map((i) => (
              <div key={i} className="bg-t-panel-2 p-4 border border-t-line">
                <p className="font-semibold text-t-white mb-1">{t(`funders.n${i}.label`)}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{t(`funders.n${i}.detail`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Built by someone who lived it */}
        <section className="mb-12 bg-t-panel-2 border border-t-amber p-6">
          <p className="text-sm font-semibold text-t-amber-bright mb-2 uppercase">
            {t("livedTitle")}
          </p>
          <p className="text-base text-t-white leading-relaxed mb-3">
            {t("lived1")}
          </p>
          <p className="text-sm text-t-phos leading-relaxed mb-3">
            {t("lived2")}
          </p>
          <p className="text-sm text-t-phos leading-relaxed">
            {t("lived3")}
          </p>
          <p className="text-xs text-t-phos-dim mt-4">
            {t("licenseLine")}
          </p>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <TBtn
            onClick={() => {
              updateSession({ isDemo: true, audience: "observer" });
              router.push("/welcome?demo=true");
            }}
            className="w-full"
          >
            {t("seeDemo")}
          </TBtn>

          <button
            onClick={() => router.push("/intro")}
            className="t-focus w-full px-4 py-3 text-t-phos-dim text-sm hover:text-t-amber-bright transition-colors"
          >
            &larr; {t("backIntro")}
          </button>
        </div>

      </div>
    </div>
  );
}
