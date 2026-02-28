"use client";

/**
 * Page 3: What Are You Looking For
 *
 * Purpose exploration first (Ikigai-inspired, Maruna generative identity).
 * Position field NOT mandatory.
 * Alternative prompts: "What kind of work interests you?" /
 * "What are you good at?" / "What matters to you in a job?"
 * No blue-collar assumptions.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { FlowPage, CardSelect, GhostGuide } from "@crucible/consumer-ui";

const GOAL_OPTIONS = [
  {
    id: "stability",
    label: "Something stable",
    description: "Consistent hours, reliable income, a place I can stay.",
  },
  {
    id: "growth",
    label: "Room to grow",
    description: "I want to build skills and move up over time.",
  },
  {
    id: "meaning",
    label: "Work that matters to me",
    description: "I care about what I do, not just the paycheck.",
  },
  {
    id: "immediate",
    label: "Something right now",
    description: "I need income fast. I'll figure out the rest later.",
  },
];

export default function GoalsPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const [selected, setSelected] = useState<string[]>(session.goals || []);
  const [narrative, setNarrative] = useState(session.goalNarrative || "");
  const [showNarrative, setShowNarrative] = useState(false);

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "goals"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    updateSession({
      goals: selected,
      goalNarrative: narrative || undefined,
      lastPageVisited: "goals",
    });
    router.push("/story");
  }

  return (
    <FlowPage
      title="What matters to you in work?"
      subtitle="Pick as many as feel right. There are no wrong answers."
      actionLabel="Continue"
      actionDisabled={selected.length === 0 && !narrative.trim()}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/resume")}
      footer={
        <p>
          Not sure yet? That&apos;s okay — pick what feels closest and we&apos;ll
          explore together.
        </p>
      }
    >
      <GhostGuide
        message="Pick what feels true to you. This isn't a test — it helps me understand what matters to you."
        pageId="goals"
      />
      <CardSelect
        options={GOAL_OPTIONS}
        selected={selected}
        onSelect={handleSelect}
        multi
      />

      {/* Optional free-text for more nuanced expression */}
      <div className="mt-6">
        {!showNarrative ? (
          <button
            onClick={() => setShowNarrative(true)}
            className="text-sm text-sage-600 underline underline-offset-2 hover:text-sage-700"
          >
            Want to say more about what you&apos;re looking for?
          </button>
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="goal-narrative"
              className="text-sm font-medium text-foreground"
            >
              Tell us more in your own words
            </label>
            <textarea
              id="goal-narrative"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="e.g., I want to work with my hands, or I'm interested in healthcare, or I want to start my own business someday..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y"
            />
          </div>
        )}
      </div>
    </FlowPage>
  );
}
