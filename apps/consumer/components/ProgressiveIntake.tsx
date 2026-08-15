"use client";

/**
 * <ProgressiveIntake> -- the reusable intake UI for the Refinery (Phase 1 + 5.4).
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
 *
 * Phase 5.4 additions:
 *   - VOICE input on every question (SpeechRecognition), so a user can speak
 *     instead of type.
 *   - PROMINENT SKIP framed as a peer choice: skipping any question is fine,
 *     more detail just makes a stronger plan.
 *   - LIVE SUFFICIENCY METER (poor/fair/good/strong) from answer specificity --
 *     a pure client heuristic that encourages without shaming.
 *   - PLAIN-LANGUAGE mode: simpler helper copy and a hint to the follow-up model.
 */

import { useRef, useState } from "react";
import type { IntakeAnswer, IntakeContext } from "@/lib/intake-engine";
import {
  computeSufficiency,
  sufficiencyCopy,
  sufficiencyIndex,
  SUFFICIENCY_LEVELS,
} from "@/lib/sufficiency";

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
  /** 7.2 plain-language preference -- simpler phrasing when on. */
  plainLanguage?: boolean;
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
  plainLanguage = false,
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
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const aiRounds = rounds.length - 1;
  const canDeepen = aiRounds < maxFollowUpRounds;

  // Live sufficiency across everything answered so far.
  const allAnswerTexts = Object.values(answers);
  const sufficiency = computeSufficiency(allAnswerTexts);
  const sufficiencyPct = ((sufficiencyIndex(sufficiency) + 1) / SUFFICIENCY_LEVELS.length) * 100;

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

  /** Speak-to-fill one field. Appends the transcript to whatever is there. */
  function startVoice(fieldId: string) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input requires Chrome or Edge.");
      return;
    }
    if (recordingId) {
      recognitionRef.current?.stop();
      setRecordingId(null);
      if (recordingId === fieldId) return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    recognitionRef.current = r;
    r.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((res: any) => res[0].transcript)
        .join(" ");
      setAnswers((prev) => ({
        ...prev,
        [fieldId]: [prev[fieldId]?.trim(), text.trim()].filter(Boolean).join(" "),
      }));
    };
    r.onend = () => setRecordingId(null);
    r.onerror = () => setRecordingId(null);
    r.start();
    setRecordingId(fieldId);
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
          plainLanguage,
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

  function skipRest() {
    onComplete(collectAnswers());
  }

  // On the final allowed round the button finishes; before that it deepens.
  const buttonLabel = canDeepen ? "Continue" : submitLabel;

  return (
    <div className="space-y-6">
      {rounds.map((round, roundIndex) => (
        <div key={roundIndex} className="space-y-4">
          {roundIndex > 0 && (
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-t-line" />
              <span className="text-xs font-medium text-t-amber-bright uppercase">
                {plainLanguage ? "A couple more questions" : "A couple of follow-ups, based on what you shared"}
              </span>
              <span className="h-px flex-1 bg-t-line" />
            </div>
          )}
          {round.map((q) => (
            <div key={q.id}>
              <label htmlFor={q.id} className="text-sm font-medium text-t-white block mb-1">
                {q.label}
              </label>
              <div className="flex gap-2 items-start">
                {q.multiline ? (
                  <textarea
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder={q.placeholder}
                    rows={3}
                    className="flex-1 px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y"
                  />
                ) : (
                  <input
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder={q.placeholder}
                    className="flex-1 px-4 py-3 border border-t-line text-base bg-t-panel text-t-white min-h-touch focus:border-t-amber focus:outline-none transition-colors"
                  />
                )}
                <button
                  type="button"
                  onClick={() => startVoice(q.id)}
                  title={recordingId === q.id ? "Stop recording" : "Speak your answer"}
                  className={`t-focus p-3 border transition-colors min-h-touch flex-shrink-0 ${
                    recordingId === q.id
                      ? "bg-t-panel-2 border-t-red text-t-red animate-pulse"
                      : "border-t-line text-t-phos-dim hover:border-t-amber hover:text-t-amber-bright"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
              </div>
              {q.seedValue && (
                <p className="text-xs text-t-phos-dim mt-1">{q.seedNote ?? SEED_NOTE_DEFAULT}</p>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Live sufficiency meter -- encourages, never shames. */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-t-white capitalize">
            Plan strength: {sufficiency}
          </span>
          <span className="text-xs text-t-phos-dim">{sufficiencyCopy(sufficiency)}</span>
        </div>
        <div className="h-2 w-full bg-t-panel-2 border border-t-line overflow-hidden">
          <div
            className="h-full bg-t-amber transition-all"
            style={{ width: `${sufficiencyPct}%` }}
          />
        </div>
      </div>

      {error && <p className="text-sm text-t-amber-bright">{error}</p>}

      <p className="text-xs text-t-phos-dim">
        You can skip any question. More detail just makes a stronger plan -- it is
        always your choice how much to share.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleAdvance}
          disabled={thinking || busy}
          className="t-focus px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
        >
          {thinking ? "Reading your answers..." : buttonLabel}
        </button>
        {canDeepen && (
          <button
            onClick={skipRest}
            disabled={thinking || busy}
            className="text-sm font-medium text-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
          >
            Skip the rest and build my plan
          </button>
        )}
        {thinking && (
          <div className="w-5 h-5 border-2 border-t-amber border-t-transparent animate-spin" />
        )}
      </div>
    </div>
  );
}

export default ProgressiveIntake;
