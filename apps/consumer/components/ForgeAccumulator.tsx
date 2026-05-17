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

const READINESS_LABELS: Record<string, string> = {
  precontemplation: "Exploring",
  contemplation: "Thinking about it",
  preparation: "Getting ready",
  action: "Ready to go",
};

const GOAL_LABELS: Record<string, string> = {
  stability: "Stability",
  growth: "Growth",
  meaning: "Meaningful work",
  immediate: "Immediate income",
};

export default function ForgeAccumulator() {
  const { session } = useForgeSession();

  // Don't show if nothing accumulated yet
  const hasResume = !!session.resumeText;
  const hasGoals = (session.goals?.length ?? 0) > 0;
  const hasChallenges = (session.challenges?.length ?? 0) > 0;
  const hasPreferences = !!session.preferences?.schedule || !!session.preferences?.environment;

  const itemCount = [hasResume, hasGoals, hasChallenges, hasPreferences].filter(Boolean).length;
  if (itemCount === 0) return null;

  return (
    <div className="bg-sage-50/60 rounded-xl px-4 py-3 mb-4 border border-sage-100">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          {[hasResume, hasGoals, hasChallenges, hasPreferences].map((filled, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                filled ? "bg-sage-500" : "bg-sage-200"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-sage-600">
          Building your story
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-sage-600">
        {session.readinessStage && (
          <span>{READINESS_LABELS[session.readinessStage] || session.readinessStage}</span>
        )}
        {hasResume && (
          <span>
            Resume {session.resumeMethod === "guided" ? "(built together)" : "received"}
          </span>
        )}
        {hasGoals && (
          <span>
            {session.goals!.map((g) => GOAL_LABELS[g] || g).join(", ")}
          </span>
        )}
        {hasChallenges && (
          <span>
            {session.challenges!.length} {session.challenges!.length === 1 ? "hurdle" : "hurdles"} noted
          </span>
        )}
        {hasPreferences && (
          <span>Preferences set</span>
        )}
      </div>
    </div>
  );
}
