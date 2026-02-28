"use client";

/**
 * Page 0.5: Mandatory Intro — The Ghost Introduces Itself
 *
 * Conversational reveal: Troy's philosophy, what's about to happen,
 * and audience selection. NOT a wall of text — a conversation-style
 * reveal using the FlowPage pattern.
 *
 * Audience selection changes how The Ghost communicates throughout
 * the Forge flow (client / partner / observer).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { FlowPage, CardSelect } from "@crucible/consumer-ui";

type Audience = "client" | "partner" | "observer";

const INTRO_LINES = [
  "Hey. I\u2019m The Ghost \u2014 the AI behind this tool.",
  "I was built by someone who knows what it\u2019s like to rebuild. Not from a textbook. From life.",
  "Here\u2019s what\u2019s about to happen: I\u2019m going to ask you some questions. About your work, your skills, what you\u2019re looking for, and what\u2019s standing in your way.",
  "It takes about 10 minutes. You\u2019ll do some real work. That\u2019s the point.",
  "Nobody can hand you a career. But I can help you see what\u2019s already there \u2014 and figure out what\u2019s next.",
];

const AUDIENCE_OPTIONS = [
  {
    id: "client",
    label: "I\u2019m looking for work or rebuilding my career",
    description:
      "I want to use this tool to explore my options and build a plan.",
  },
  {
    id: "partner",
    label: "I\u2019m from a partner organization",
    description:
      "AJC, nonprofit, DOC, or similar \u2014 I want to see how this works.",
  },
  {
    id: "observer",
    label: "I\u2019m here to learn about this tool",
    description:
      "Funder, researcher, media, or just curious about what this does.",
  },
];

export default function IntroPage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();
  const [visibleLines, setVisibleLines] = useState(0);
  const [showAudience, setShowAudience] = useState(false);
  const [selected, setSelected] = useState<string>("");

  // Reveal lines one at a time with a conversational cadence
  useEffect(() => {
    if (visibleLines < INTRO_LINES.length) {
      const delay = visibleLines === 0 ? 400 : 1200;
      const timer = setTimeout(() => setVisibleLines((v) => v + 1), delay);
      return () => clearTimeout(timer);
    } else {
      // All lines visible — show audience selection after a beat
      const timer = setTimeout(() => setShowAudience(true), 800);
      return () => clearTimeout(timer);
    }
  }, [visibleLines]);

  function handleContinue() {
    if (!selected) return;

    updateSession({
      audience: selected as Audience,
      pagesVisited: ["intro"],
    });

    // Also persist audience to localStorage for pre-auth Ghost access
    try {
      localStorage.setItem("forge_audience", selected);
    } catch {
      // localStorage may be unavailable
    }

    router.push("/welcome");
  }

  return (
    <FlowPage
      title="Before we start"
      subtitle=""
      actionLabel={showAudience && selected ? "Let\u2019s go" : undefined}
      actionDisabled={!selected}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/")}
    >
      {/* Conversational reveal */}
      <div className="space-y-4 mb-8">
        {INTRO_LINES.slice(0, visibleLines).map((line, i) => (
          <p
            key={i}
            className="text-body text-foreground leading-relaxed animate-fadeIn"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            {line}
          </p>
        ))}
      </div>

      {/* Audience selection — appears after all lines are visible */}
      {showAudience && (
        <div className="animate-fadeIn">
          <p className="font-medium text-foreground mb-4">
            Before we jump in — which best describes you?
          </p>
          <CardSelect
            options={AUDIENCE_OPTIONS}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      )}
    </FlowPage>
  );
}
