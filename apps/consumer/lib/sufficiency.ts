/**
 * Phase 5.4 -- live intake sufficiency meter (PURE, no network, no DB).
 *
 * A simple, honest heuristic that tells the user how complete their intake
 * answers are: poor / fair / good / strong. It rewards LENGTH and a little
 * CONCRETENESS (word count, a number or two), so a one-word answer reads poor
 * and a real, specific answer reads strong. It never shames -- the UI copy
 * frames every level as "more detail makes a stronger plan," never "you failed."
 *
 * Deliberately a client-side heuristic (no AI): it must update instantly as the
 * user types, and it must be deterministic and testable.
 */

export type SufficiencyLevel = "poor" | "fair" | "good" | "strong";

export const SUFFICIENCY_LEVELS: readonly SufficiencyLevel[] = [
  "poor",
  "fair",
  "good",
  "strong",
];

/** Score one answer. Longer + more words + a concrete number scores higher.
 *  Bounded so a single very long answer cannot alone max out the meter. */
export function scoreAnswerText(text: string): number {
  const s = (text ?? "").trim();
  if (!s) return 0;
  let score = 0;
  // Length: up to 3 points (~120+ chars).
  score += Math.min(s.length / 40, 3);
  // Words: up to 2 points (~30+ words).
  const words = s.split(/\s+/).filter(Boolean).length;
  score += Math.min(words / 15, 2);
  // Concreteness: a number is a small, real specificity signal.
  if (/\d/.test(s)) score += 0.5;
  return score;
}

/**
 * Combine answers into a single sufficiency level. Monotonic-ish: adding detail
 * or answers never lowers the level. Thresholds are tuned so a 3-char answer is
 * `poor` and a detailed, specific answer is `strong`.
 */
export function computeSufficiency(
  answers: Array<string | { answer?: string }>
): SufficiencyLevel {
  const total = answers.reduce<number>((sum, a) => {
    const text = typeof a === "string" ? a : a?.answer ?? "";
    return sum + scoreAnswerText(text);
  }, 0);

  if (total < 1) return "poor";
  if (total < 2.5) return "fair";
  if (total < 4.5) return "good";
  return "strong";
}

/** Encouraging, never-shaming copy for each level. */
export function sufficiencyCopy(level: SufficiencyLevel): string {
  switch (level) {
    case "poor":
      return "Just getting started. A little more detail will make a stronger plan.";
    case "fair":
      return "Good start. A bit more and your plan will really sound like you.";
    case "good":
      return "Nice and clear. This is enough for a solid plan.";
    case "strong":
      return "Rich and specific. Your plan will sound like you, not a template.";
  }
}

/** 0-3 index for rendering a simple 4-segment bar. */
export function sufficiencyIndex(level: SufficiencyLevel): number {
  return SUFFICIENCY_LEVELS.indexOf(level);
}
