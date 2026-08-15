/**
 * Progressive-intake engine -- the shared "brains" behind <ProgressiveIntake>.
 *
 * Troy's vision (2026-06-09): after a user answers the initial questions, an AI
 * asks 2-3 SPECIFIC follow-ups grounded in their real answers + Forge context,
 * pulling out the concrete detail a static form never would. This is the reusable
 * intelligence reused across disclosure, interview, and the job board -- the heart
 * of "award-winning intelligence."
 *
 * These helpers are PURE (no network, no fs) so the route stays thin and the
 * prompt logic is reviewable on its own. The route (/api/intake/followups) calls
 * callAI(system, [answers], 800, MODEL_DEEP) with the prompt these build, then
 * runs the response through parseFollowups (which fails SAFE -- "done" -- on any
 * malformed output so the intake can never trap the user).
 */

import { sanitizeForPrompt } from "./sanitize";

export interface IntakeContext {
  targetJob?: string;
  headline?: string;
  strengths?: string[];
  skills?: string[];
  hasRecord?: boolean;
}

export interface IntakeAnswer {
  question: string;
  answer: string;
}

/** Hard cap on AI follow-up rounds -- defense in depth (the client also bounds it). */
export const MAX_FOLLOWUP_ROUNDS = 2;

function topicFraming(topic: string): string {
  switch (topic) {
    case "disclosure":
      return "They are preparing to talk about their record with an employer -- the framing, the timing, and the pivot to their strengths. Focus on how they want to TELL their story now, not the legal details of what happened. Never ask them to relive the offense.";
    case "interview":
      return "They are preparing for a real job interview. Draw out concrete stories, numbers, and examples they can turn into strong answers -- the specifics behind what they have told you.";
    case "jobs":
      return "They are figuring out what work to look for. Draw out what they actually want and are good at, and the real-life constraints that matter -- schedule, location, pay, transportation, what a good day looks like.";
    default:
      return "Draw out the specific, real, usable detail behind what they have told you.";
  }
}

export function buildFollowupsSystemPrompt(
  topic: string,
  context: IntakeContext,
  plainLanguage = false
): string {
  const known: string[] = [];
  if (context.targetJob) known.push(`Target role: ${sanitizeForPrompt(context.targetJob, 120)}`);
  if (context.headline) known.push(`Their headline: ${sanitizeForPrompt(context.headline, 200)}`);
  if (context.strengths?.length) {
    known.push(
      `Their strengths: ${context.strengths.slice(0, 8).map((s) => sanitizeForPrompt(s, 80)).join("; ")}`
    );
  }
  if (context.skills?.length) {
    known.push(
      `Their skills: ${context.skills.slice(0, 12).map((s) => sanitizeForPrompt(s, 60)).join(", ")}`
    );
  }
  if (context.hasRecord) {
    known.push("They have a criminal record (already known -- do NOT ask them to describe the offense).");
  }
  const knownBlock = known.length
    ? known.join("\n")
    : "(No Forge profile yet -- ask the foundational questions for this topic.)";

  return `You are an expert career coach for justice-impacted jobseekers. You ask the SHARPEST possible follow-up questions -- the ones that pull the specific, real, usable detail a generic form never would. You are the expert; it is your responsibility to extract what matters, even from someone who does not know what to say.

CONTEXT FOR THIS PERSON:
${topicFraming(topic)}

WHAT YOU ALREADY KNOW ABOUT THEM (use it -- reference their real situation, never re-ask it):
${knownBlock}

You will be given what they have answered so far. Read it closely, then EITHER:
- Ask 2-3 specific follow-up questions that go DEEPER on what they actually said -- name the thing they mentioned, build on their words. OR
- If their answers already hold enough concrete, usable depth for this topic, stop.

RULES:
- Plain language, 6th-grade reading level. Warm, human, never clinical.${
    plainLanguage
      ? "\n- PLAIN-LANGUAGE MODE IS ON: keep every question extra short and simple. Use everyday words. Aim for a 4th-grade reading level. No jargon."
      : ""
  }
- One idea per question -- no compound questions.
- Build on THEIR words. If they mention a place, a person, or a task, ask about THAT.
- Never re-ask anything they already told you or that you already know above.
- Forward-looking and strengths-oriented, even on disclosure -- about how they talk now, not the details of an offense or any trauma.
- Return JSON ONLY, no prose: {"questions":["...","..."],"done":false}  -- or, when there is already enough depth: {"questions":[],"done":true}`;
}

export function buildAnswersBlock(answersSoFar: IntakeAnswer[], round: number): string {
  const lines = answersSoFar
    .filter((a) => (a.answer ?? "").trim())
    .map((a) => `Q: ${sanitizeForPrompt(a.question, 200)}\nA: ${sanitizeForPrompt(a.answer, 600)}`)
    .join("\n\n");
  return `Here is what they have shared so far (round ${round}):\n\n${lines}\n\nAsk your 2-3 follow-up questions now, or return done if there is already enough depth.`;
}

/**
 * Parse the model's JSON response into a normalized result. Fails SAFE: any
 * missing/malformed output returns { questions: [], done: true } so a bad
 * generation ends the intake gracefully rather than trapping the user.
 */
export function parseFollowups(
  raw: string,
  opts: { maxQuestions?: number } = {}
): { questions: string[]; done: boolean } {
  const maxQuestions = opts.maxQuestions ?? 3;
  const stop = { questions: [] as string[], done: true };
  if (!raw) return stop;

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return stop;

  try {
    const parsed = JSON.parse(match[0]);
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q: string) => q.trim())
          .slice(0, maxQuestions)
      : [];
    if (questions.length === 0) return stop;
    // An explicit done:true stops even if stray questions came back.
    if (parsed.done === true) return stop;
    return { questions, done: false };
  } catch {
    return stop;
  }
}
