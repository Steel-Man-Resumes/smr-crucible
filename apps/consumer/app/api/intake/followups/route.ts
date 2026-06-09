/**
 * Progressive Intake -- Follow-ups API
 *
 * POST /api/intake/followups
 *   body: { topic, context, answersSoFar, round }
 *   -> { questions: string[], done: boolean }
 *
 * After the user answers the initial questions, this asks MODEL_DEEP (Opus 4.8)
 * for 2-3 SPECIFIC follow-up questions grounded in their real answers + Forge
 * context -- the shared intelligence reused by disclosure, interview, and the job
 * board. Privacy: we send only the user's own answers/context (sanitized) to
 * shape their own questions, and the decision log records shape, never words.
 *
 * Fails OPEN everywhere -- any error returns { questions: [], done: true } so a
 * hiccup ends the intake gracefully instead of trapping the user mid-flow.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { isMockEnabled, MOCK_INTAKE_FOLLOWUPS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import {
  buildFollowupsSystemPrompt,
  buildAnswersBlock,
  parseFollowups,
  MAX_FOLLOWUP_ROUNDS,
  type IntakeContext,
  type IntakeAnswer,
} from "@/lib/intake-engine";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const topic: string = typeof body.topic === "string" ? body.topic : "general";
    const context: IntakeContext =
      body.context && typeof body.context === "object" ? body.context : {};
    const answersSoFar: IntakeAnswer[] = Array.isArray(body.answersSoFar)
      ? body.answersSoFar
      : [];
    const round: number = Number.isFinite(body.round)
      ? Math.max(0, Math.floor(body.round))
      : 0;

    // Hard cap + nothing-to-deepen: stop without spending a token.
    if (round >= MAX_FOLLOWUP_ROUNDS || answersSoFar.length === 0) {
      return NextResponse.json({ questions: [], done: true });
    }

    if (isMockEnabled()) {
      return NextResponse.json({ questions: MOCK_INTAKE_FOLLOWUPS, done: false });
    }

    const system = buildFollowupsSystemPrompt(topic, context);
    const userMsg = buildAnswersBlock(answersSoFar, round);

    const raw = await callAI(system, [{ role: "user", content: userMsg }], 800, MODEL_DEEP);
    const result = parseFollowups(raw, { maxQuestions: 3 });

    // Decision log (JBS compliance) -- shape only, never the user's words.
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "intake-followups",
        modelProvider: AI_PROVIDER,
        modelId: MODEL_DEEP,
        input: `topic=${topic} round=${round} answers=${answersSoFar.length}`,
        explanation: `Progressive intake follow-ups for ${topic}, round ${round}.`,
        outputSummary: {
          type: "intake_followups",
          topic,
          round,
          question_count: result.questions.length,
          done: result.done,
        },
      });
    } catch (err) {
      console.error("Decision log failed (intake followups):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Intake followups error:", error);
    // Fail open -- never trap the user mid-intake.
    return NextResponse.json({ questions: [], done: true });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "intake-followups",
  requiredTier: "client",
});
