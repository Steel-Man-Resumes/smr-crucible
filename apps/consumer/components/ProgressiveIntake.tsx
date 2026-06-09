"use client";

/**
 * <ProgressiveIntake> -- the reusable intake UI for the Refinery (Phase 1).
 *
 * Renders an initial question set, then asks /api/intake/followups for 2-3
 * AI-generated follow-ups grounded in the user's answers + Forge context, loops
 * up to `maxFollowUpRounds`, and returns the full enriched answer set via
 * onComplete. The shared "intelligent" intake reused by disclosure, interview,
 * and the job board.
 *
 * Doctrine (Troy 2026-06-09): every Forge-seeded field is a normal editable input
 * with a "from your Forge -- edit anytime" note. NOTHING is greyed out or locked --
 * the user must be able to edit it and go deeper. The flow also fails open: any
 * API hiccup completes the intake with what we have rather than trapping the user.
 */

import { useState } from "react";
import type { IntakeAnswer, IntakeContext } from "@/lib/intake-engine";

export interface IntakeQuestion {
  id: string;
  label: string;
  placeholder?: string;
  /** Forge-seeded starting value. Always editable -- never locked. */
  seedValue?: string;
  /** Small note under the field, e.g. "From your Forge -- edit anytime". */
  seedNote?: string;
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean;
}

interface ProgressiveIntakeProps {
  topic: string;
  context?: IntakeContext;
  initialQuestions: IntakeQuestion[];
  /** Max AI follow-up rounds after the initial questions. Default 2. */
  maxFollowUpRounds?: number;
  /** Label for the final submit button once there are no more follow-ups. */
  submitLabel?: string;
  /** Called with the full enriched answer set when the intake completes. */
  onComplete: (answers: IntakeAnswer[]) => void;
  /** Parent is generating downstream -- disables the final submit. */
  busy?: boolean;
}

const SEED_NOTE_DEFAULT = "From your Forge -- edit anytime.";

export function ProgressiveIntake({
  topic,
  context,
  initialQuestions,
  maxFollowUpRounds = 2,
  submitLabel = "Continue",
  onComplete,
  busy = false,
}: ProgressiveIntakeProps) {
  const [rounds, setRounds] = useState<IntakeQuestion[][]>([initialQuestions]);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const q of initialQuestions) {
      if (q.seedValue) seed[q.id] = q.seedValue;
    }
    return seed;
  });
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");

  const aiRounds = rounds.length - 1;
  const canDeepen = aiRounds < maxFollowUpRounds;
  const latestRound = rounds[rounds.length - 1];
  const currentAnswered = latestRound.some((q) => (answers[q.id] ?? "").trim().length > 0);

  function collectAnswers(): IntakeAnswer[] {
    const out: IntakeAnswer[] = [];
    for (const round of rounds) {
      for (const q of round) {
        const a = (answers[q.id] ?? "").trim();
        if (a) out.push({ question: q.label, answer: a });
      }
    }
    return out;
  }

  async function handleAdvance() {
    if (thinking || busy) return;
    const collected = collectAnswers();

    // No more follow-ups allowed -> finish with what we have.
    if (!canDeepen) {
      onComplete(collected);
      return;
    }

    setThinking(true);
    setError("");
    try {
      const res = await fetch("/api/intake/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          context: context ?? {},
          answersSoFar: collected,
          round: aiRounds,
        }),
      });
      const data = res.ok ? await res.json() : { questions: [], done: true };
      const questions: string[] = Array.isArray(data.questions)
        ? data.questions.filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0)
        : [];

      if (data.done || questions.length === 0) {
        onComplete(collected);
        return;
      }

      const nextRoundIndex = rounds.length;
      const newRound: IntakeQuestion[] = questions.slice(0, 3).map((label, i) => ({
        id: `fu-${nextRoundIndex}-${i}`,
        label,
        multiline: true,
        placeholder: "Take your time -- a sentence or two is plenty.",
      }));
      setRounds((prev) => [...prev, newRound]);
    } catch {
      // Fail open -- a hiccup should never trap the user mid-intake.
      onComplete(collectAnswers());
    } finally {
      setThinking(false);
    }
  }

  // On the final allowed round the button finishes; before that it deepens.
  const buttonLabel = canDeepen ? "Continue" : submitLabel;

  return (
    <div className="space-y-6">
      {rounds.map((round, roundIndex) => (
        <div key={roundIndex} className="space-y-4">
          {roundIndex > 0 && (
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-sage-200" />
              <span className="text-xs font-medium text-sage-700 uppercase tracking-wide">
                A couple of follow-ups, based on what you shared
              </span>
              <span className="h-px flex-1 bg-sage-200" />
            </div>
          )}
          {round.map((q) => (
            <div key={q.id}>
              <label htmlFor={q.id} className="text-sm font-medium block mb-1">
                {q.label}
              </label>
              {q.multiline ? (
                <textarea
                  id={q.id}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder={q.placeholder}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y"
                />
              ) : (
                <input
                  id={q.id}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder={q.placeholder}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch focus:border-sage-600 transition-colors"
                />
              )}
              {q.seedValue && (
                <p className="text-xs text-sage-600 mt-1">{q.seedNote ?? SEED_NOTE_DEFAULT}</p>
              )}
            </div>
          ))}
        </div>
      ))}

      {error && <p className="text-sm text-amber-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleAdvance}
          disabled={thinking || busy || !currentAnswered}
          className="px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
        >
          {thinking ? "Reading your answers..." : buttonLabel}
        </button>
        {thinking && (
          <div className="w-5 h-5 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </div>
  );
}

export default ProgressiveIntake;
