"use client";

/**
 * ForgeAccumulator -- Progressive info accumulation display.
 *
 * Shows a compact, growing summary of what the user has provided so far.
 * Appears on pages after the first input (resume onward).
 * Designed to make the user feel their info is building toward something.
 *
 * In Forge: session-based, temporary.
 * In Refinery: this becomes permanent dashboard data.
 */

import { useForgeSession } from "@/lib/forge-context";
import { useTranslations } from "next-intl";

// Labels by id live in the catalog (messages/<locale>/forge.json, "accumulator").
const READINESS_IDS = ["precontemplation", "contemplation", "preparation", "action"];
const GOAL_IDS = ["stability", "growth", "meaning", "immediate", "independence", "community", "flexibility", "back_to_my_trade"];

export default function ForgeAccumulator() {
  const { session } = useForgeSession();
  const t = useTranslations("forge.accumulator");

  // Don't show if nothing accumulated yet
  const hasResume = !!session.resumeText;
  const hasGoals = (session.goals?.length ?? 0) > 0;
  const hasChallenges = (session.challenges?.length ?? 0) > 0;
  const hasPreferences = !!session.preferences?.schedule || !!session.preferences?.environment;

  const itemCount = [hasResume, hasGoals, hasChallenges, hasPreferences].filter(Boolean).length;
  if (itemCount === 0) return null;

  return (
    <div className="bg-t-panel px-4 py-3 mb-4 border border-t-line">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          {[hasResume, hasGoals, hasChallenges, hasPreferences].map((filled, i) => (
            <div
              key={i}
              className={`w-2 h-2 transition-colors ${
                filled ? "bg-t-amber" : "bg-t-line"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-t-phos-dim">
          {t("building")}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-t-phos">
        {session.readinessStage && (
          <span>{READINESS_IDS.includes(session.readinessStage) ? t(`readiness.${session.readinessStage}`) : session.readinessStage}</span>
        )}
        {hasResume && (
          <span>
            {session.resumeMethod === "guided" ? t("resumeBuilt") : t("resumeReceived")}
          </span>
        )}
        {hasGoals && (
          <span>
            {session.goals!.map((g) => (GOAL_IDS.includes(g) ? t(`goals.${g}`) : g)).join(", ")}
          </span>
        )}
        {hasChallenges && (
          <span>
            {t("hurdles", { count: session.challenges!.length })}
          </span>
        )}
        {hasPreferences && (
          <span>{t("preferencesSet")}</span>
        )}
      </div>
    </div>
  );
}
