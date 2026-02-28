"use client";

/**
 * Page 1: Welcome / Readiness Detection
 *
 * Detects Stages of Change (Prochaska & DiClemente) through
 * natural conversational prompts — NOT a quiz or assessment.
 *
 * Replaces the killed tech-savvy page.
 * AI assistant available but not forced.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { FlowPage, CardSelect } from "@crucible/consumer-ui";

type ReadinessStage =
  | "precontemplation"
  | "contemplation"
  | "preparation"
  | "action";

// Natural language options that map to Stages of Change
// without using clinical terminology
const READINESS_OPTIONS = [
  {
    id: "exploring",
    label: "Just exploring",
    description: "I'm not sure if I'm ready to look for work yet, but I'm curious.",
  },
  {
    id: "thinking",
    label: "Thinking about it",
    description: "I know I need to do something, but I'm not sure where to start.",
  },
  {
    id: "getting-ready",
    label: "Getting ready",
    description: "I've decided to make a change. I want to figure out my next steps.",
  },
  {
    id: "ready-now",
    label: "Ready to go",
    description: "I'm actively looking for work and need real tools right now.",
  },
];

// Maps natural language to clinical stages
const STAGE_MAP: Record<string, ReadinessStage> = {
  exploring: "precontemplation",
  thinking: "contemplation",
  "getting-ready": "preparation",
  "ready-now": "action",
};

export default function WelcomePage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();
  const [selected, setSelected] = useState<string>("");

  function handleContinue() {
    if (!selected) return;

    const readinessStage = STAGE_MAP[selected];
    updateSession({
      readinessStage,
      startedAt: new Date().toISOString(),
      lastPageVisited: "welcome",
    });

    router.push("/resume");
  }

  return (
    <FlowPage
      title="Where are you at right now?"
      subtitle="There's no wrong answer. This helps us meet you where you are."
      actionLabel="Continue"
      actionDisabled={!selected}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/")}
      footer={
        <p>
          Everything here is private. You can change your answer at any time.
        </p>
      }
    >
      <CardSelect
        options={READINESS_OPTIONS}
        selected={selected}
        onSelect={setSelected}
      />
    </FlowPage>
  );
}
