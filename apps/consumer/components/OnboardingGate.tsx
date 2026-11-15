"use client";

/**
 * OnboardingGate -- makes a tool PAGE enforce the same onboarding-state lock its
 * dashboard tile + sidebar already advertise (F8/F15: the tiles said "locked" but
 * the pages opened to anyone, and t.ROY could route straight in). Disclosure Planner
 * and Interview Practice are built around a tailored target job, so they unlock at
 * `full_access` (reached by tailoring a resume -- which Phase 1 decoupled from the
 * live job board, so a pasted job description is enough).
 *
 * Honest, not a dead end: a locked user sees exactly what to do next with a CTA to
 * the Application Tailor. Optimistic while the state resolves (renders children so
 * full-access users -- the common case -- never see a flash or an extra spinner);
 * only swaps to the lock once state is KNOWN to be below requirement. Admin/partner
 * resolve to full_access via useOnboarding, so they pass straight through.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";
// Deep, runtime-pure import: the one shared gate-state ordering, no db/pg pulled
// into the client bundle (see @crucible/core/src/gateRank).
import { GATE_STATE_RANK } from "@crucible/core/src/gateRank";

export function OnboardingGate({
  requiredState = "full_access",
  toolName,
  previewFeature,
  children,
}: {
  requiredState?: OnboardingState;
  toolName: string;
  /** Registry id (e.g. "disclosure", "interview"): adds a "See a preview" button
   *  to the lock screen. A preview NEVER bypasses this gate -- it just shows the
   *  locked user what the tool does before they finish unlocking it. */
  previewFeature?: string;
  children: ReactNode;
}) {
  const t = useTranslations("refineryInterview.gate");
  const { state } = useOnboarding();

  // Optimistic: never lock while we don't yet know (loading) -- avoids a flash and
  // an extra round-trip for the full-access majority.
  const locked = state !== "loading" && GATE_STATE_RANK[state] > GATE_STATE_RANK[requiredState];
  if (!locked) return <>{children}</>;

  const needsProfile = state === "needs_profile";
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="border border-t-line bg-t-panel p-8 text-center">
        <p className="text-lg font-bold text-t-white mb-2">{t("title", { tool: toolName })}</p>
        <p className="text-sm text-t-phos-dim mb-6 leading-relaxed">
          {needsProfile
            ? t("needsProfile")
            : t("needsResume", { tool: toolName })}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {needsProfile ? (
            <a
              href="https://forge.steelmanresumes.com"
              className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright transition-colors"
            >
              {t("finishForge")}
            </a>
          ) : (
            <Link
              href="/dashboard/application-tailor"
              className="t-focus px-6 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright transition-colors"
            >
              {t("tailor")}
            </Link>
          )}
          {previewFeature && (
            <Link
              href={`/dashboard/preview/${previewFeature}`}
              className="t-focus px-6 py-3 bg-transparent text-t-amber-bright border border-t-amber font-bold hover:bg-t-amber/10 transition-colors"
            >
              {t("preview")}
            </Link>
          )}
          <Link
            href="/dashboard"
            className="t-focus px-6 py-3 bg-transparent text-t-amber-bright border border-t-amber font-bold hover:bg-t-amber/10 transition-colors"
          >
            {t("backToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}
