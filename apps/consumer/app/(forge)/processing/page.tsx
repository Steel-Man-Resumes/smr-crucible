"use client";

/**
 * Page 6: Processing / Wait State
 *
 * Transparent about what's happening.
 * Progress animation + engagement content (fair chance facts, success stories).
 * Pennebaker micro-dose: optional 2-minute expressive writing prompt.
 * Under the hood: narrative analysis pipeline via /api/analyze
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";

const PROCESSING_STEPS = [
  "Reading your experience...",
  "Finding your strengths...",
  "Matching career paths...",
  "Connecting barriers to resources...",
  "Crafting your narrative...",
  "Almost done...",
];

const ENGAGEMENT_FACTS = [
  "Over 70 million Americans have some kind of criminal record. You're not alone.",
  "Ban-the-box laws now cover over 37 states. Many employers can't ask about your record on the application.",
  "Studies show that formerly incarcerated employees have lower turnover rates than average.",
  "The first 6 months after release are the hardest for finding work. It gets easier.",
  "Fair-chance employers actively seek people with records. They know the value you bring.",
  "Research shows naming your challenges out loud reduces their power over you.",
  "Your transferable skills — reliability, problem-solving, resilience — are what employers need most.",
];

const REFLECTION_PROMPTS = [
  "While you wait, take a moment: What's one thing you're proud of?",
  "Think about this: What's one skill you have that most people don't?",
  "A question to sit with: What kind of person do you want to be at work?",
];

export default function ProcessingPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const [currentStep, setCurrentStep] = useState(0);
  const [currentFact, setCurrentFact] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState("");
  const hasStarted = useRef(false);

  // Run the analysis pipeline
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

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

  // Rotate through facts
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentFact((prev) => (prev + 1) % ENGAGEMENT_FACTS.length);
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const reflectionPrompt =
    REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)];

  if (error) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
        <p className="text-body text-muted mb-6 max-w-md">{error}</p>
        <button
          onClick={() => {
            setError(null);
            hasStarted.current = false;
          }}
          className="px-8 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="flow-center min-h-screen flex flex-col items-center justify-center">
      <div className="w-full max-w-flow text-center">
        {/* Processing animation */}
        <div className="mb-8">
          <div className="w-16 h-16 mx-auto mb-6 relative">
            <div className="absolute inset-0 border-4 border-sage-200 rounded-full" />
            <div className="absolute inset-0 border-4 border-sage-600 rounded-full border-t-transparent animate-spin" />
          </div>

          <h1 className="text-2xl font-bold mb-2">Building your story</h1>
          <p className="text-body text-sage-600 transition-opacity duration-500">
            {PROCESSING_STEPS[currentStep]}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-sage-100 rounded-full mb-10 overflow-hidden">
          <div
            className="h-full bg-sage-500 rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${Math.min(95, ((currentStep + 1) / PROCESSING_STEPS.length) * 100)}%`,
            }}
          />
        </div>

        {/* Engagement content */}
        <div className="bg-warm-50 rounded-2xl p-6 mb-8 min-h-[80px] flex items-center justify-center">
          <p className="text-sm text-earth-700 leading-relaxed transition-opacity duration-500">
            {ENGAGEMENT_FACTS[currentFact]}
          </p>
        </div>

        {/* Pennebaker micro-dose: optional reflection */}
        <div className="bg-white rounded-2xl p-5 border border-border">
          <p className="text-sm font-medium text-foreground mb-3">
            {reflectionPrompt}
          </p>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="Take a moment to think... (optional)"
            rows={2}
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors resize-none"
          />
          <p className="text-xs text-muted mt-2">
            Just for you — this isn&apos;t saved or analyzed.
          </p>
        </div>
      </div>
    </div>
  );
}
