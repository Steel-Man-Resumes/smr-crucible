"use client";

/**
 * Page 6: Processing / Wait State
 *
 * Transparent about what's happening.
 * Progress animation with labels that match the real analysis work.
 * Pennebaker micro-dose: optional 2-minute expressive writing prompt.
 * Under the hood: narrative analysis pipeline via /api/analyze
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_OUTPUT } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { GhostGuide } from "@crucible/consumer-ui";

// Labels describe what the analysis really does (see /api/analyze): it reads the
// person's answers, pulls out strengths and skills, looks at career paths, matches
// hurdles to places that can help, then checks the story against their own words.
// The resume and cover letter are made later, on the next page.
const PROCESSING_STEPS = [
  "Reading what you told us...",
  "Finding your strengths and skills...",
  "Looking at career paths that fit...",
  "Matching hurdles to places that can help...",
  "Checking the story against your own words...",
  "Almost done...",
];

const REFLECTION_PROMPTS = [
  "While you wait, take a moment: What's one thing you're proud of?",
  "Think about this: What's one skill you have that most people don't?",
  "A question to sit with: What kind of person do you want to be at work?",
];

export default function ProcessingPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");
  const hasStarted = useRef(false);

  // Run the analysis pipeline (or load demo data)
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    if (isDemo) {
      // Demo mode: skip API call, load pre-generated output after brief animation
      const timer = setTimeout(() => {
        updateSession({
          forgeOutput: DEMO_OUTPUT,
          lastPageVisited: "processing",
        });
        router.push("/output");
      }, 3000);
      return () => clearTimeout(timer);
    }

    async function runAnalysis() {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeText: session.resumeText,
            readinessStage: session.readinessStage,
            goals: session.goals,
            goalNarrative: session.goalNarrative,
            challenges: session.challenges,
            criminalRecord: session.criminalRecord,
            challengeNarratives: session.challengeNarratives,
            preferences: session.preferences,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Analysis failed");
        }

        const forgeOutput = await response.json();

        updateSession({
          forgeOutput,
          lastPageVisited: "processing",
        });

        // Small delay for the animation to feel complete
        await new Promise((r) => setTimeout(r, 800));
        router.push("/output");
      } catch (err: any) {
        console.error("Analysis error:", err);
        setError(err.message || "Something went wrong. Let's try again.");
      }
    }

    runAnalysis();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate through processing steps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) =>
        prev < PROCESSING_STEPS.length - 1 ? prev + 1 : prev
      );
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // Pick the reflection question once per visit, after mount. Choosing it in the
  // render body re-rolled it on every keystroke and timer tick. The first render
  // uses a fixed prompt so server and browser markup match.
  const [reflectionPrompt, setReflectionPrompt] = useState(REFLECTION_PROMPTS[0]);
  useEffect(() => {
    setReflectionPrompt(
      REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)]
    );
  }, []);

  if (error) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center bg-t-bg">
        <h1 className="text-2xl font-bold mb-4 text-t-white">Something went wrong</h1>
        <p className="text-base text-t-phos-dim mb-6 max-w-md">{error}</p>
        <button
          onClick={() => {
            setError(null);
            hasStarted.current = false;
          }}
          className="t-focus px-8 py-4 bg-t-amber text-white text-lg font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flow-center min-h-screen flex flex-col items-center justify-center">
      <div className="w-full max-w-flow text-center">
        <GhostGuide
          message={getOpusMessage("processing", audience, isDemo)}
          pageId="processing"
        />
        {/* Processing animation */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-6 relative">
            <div className="absolute inset-0 border-4 border-t-line" />
            <div className="absolute inset-0 border-4 border-t-amber border-t-transparent animate-spin" />
          </div>

          <h1 className="text-2xl font-bold mb-2 text-t-white">Building your story</h1>
          <p className="text-base text-t-amber-bright transition-opacity duration-500">
            {PROCESSING_STEPS[currentStep]}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-t-line mb-10 overflow-hidden">
          <div
            className="h-full bg-t-amber transition-all duration-1000 ease-out"
            style={{
              width: `${Math.min(95, ((currentStep + 1) / PROCESSING_STEPS.length) * 100)}%`,
            }}
          />
        </div>

        {/* Pennebaker micro-dose: optional reflection */}
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm font-medium text-t-white mb-3">
            {reflectionPrompt}
          </p>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="Take a moment to think... (optional)"
            rows={2}
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors resize-none"
          />
          <p className="text-xs text-t-phos-dim mt-2">
            Just for you. This isn&apos;t saved or analyzed.
          </p>
        </div>
      </div>
    </div>
  );
}
