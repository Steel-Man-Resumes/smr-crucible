/**
 * POST /api/next-step-why -- a warm, honest WHY for the user's CURRENT next step.
 *
 * Phase 4.4 (next-step advising). The split is strict:
 *   - computeNextStep / getNextStep own WHAT the step is (deterministic
 *     eligibility). The AI NEVER changes the recommendation, gates, or facts.
 *   - This route asks the AI to phrase 1-2 warm sentences explaining WHY that
 *     already-decided step fits the user right now, grounded only in their real
 *     journey snapshot (no fabricated freshness, no new facts).
 *
 * On mock mode, missing keys, an empty answer, or any error, it returns the
 * deterministic WHY (NEXT_STEP_WHY) instead -- so the line is always present and
 * always honest. Rate-limited (user) and decision-logged for JBS compliance.
 *
 * Body: none (or {}). userId is derived from the session.
 * Returns: { step: {stage, action, href} | null, why: string, whySource: "ai" | "deterministic" }.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { isMockEnabled } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_FAST } from "@/lib/ai/models";
import {
  getNextStep,
  buildJourneySnapshot,
  deterministicWhy,
  type NextStepResult,
} from "@crucible/core";

export const maxDuration = 15;

async function handlePost() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Deterministic step (the WHAT). AI never touches this.
  let step: NextStepResult | null = null;
  try {
    step = await getNextStep(userId);
  } catch {
    step = null;
  }

  // No computable step (e.g. no profile yet): nothing to explain.
  if (!step) {
    return NextResponse.json({ step: null, why: "", whySource: "deterministic" });
  }

  const fallback = deterministicWhy(step);

  // Mock mode or no provider key -> deterministic WHY, no AI call.
  if (isMockEnabled() || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
    return NextResponse.json({ step, why: fallback.why, whySource: fallback.whySource });
  }

  try {
    const snapshot = await buildJourneySnapshot(userId);
    const m = snapshot.metrics;
    const factLine =
      `Resumes built: ${m.resumesBuilt}. Saved jobs: ${m.savedJobs}. ` +
      `Resume tailored to a target job: ${m.resumeTailored ? "yes" : "no"}. ` +
      `Disclosure plan made: ${m.hasDisclosurePlan ? "yes" : "no"}. ` +
      `Interviews started: ${m.interviewsStarted}. Applications sent: ${m.applicationsSent}.`;

    const prompt = `A justice-impacted job seeker's decided next step is: "${sanitizeForPrompt(step.action, 200)}".
Here is where they are in their journey (facts only -- do NOT add anything that is not listed here):
${factLine}

Write ONE or TWO short sentences explaining WHY this is the right next step for THEM right now.
Rules:
- Warm, honest, encouraging. Plain words, 6th grade reading level.
- Do NOT change the step. Do NOT suggest a different action.
- Do NOT invent facts, numbers, dates, company names, or laws.
- Use "--" never an em dash. No emojis.
- Return only the sentence(s). No labels, no quotes.`;

    const raw = await callAI("", [{ role: "user", content: prompt }], 160, MODEL_FAST, {
      userId,
      endpoint: "next-step-why",
    });
    const why = raw.trim().replace(/^["']+|["']+$/g, "").trim();
    if (!why) throw new Error("empty why from AI");

    // Decision log (JBS compliance): the deterministic action is the input; the
    // AI only explained it. Never blocks the response.
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId,
        contextPage: "next-step-why",
        modelProvider: AI_PROVIDER,
        modelId: MODEL_FAST,
        input: step.action,
        explanation: "Phrased a warm WHY for the deterministic next step; the step itself was not changed.",
        outputSummary: { stage: step.stage, whySource: "ai" },
      });
    } catch (err) {
      console.error("Decision log failed (next-step-why):", err);
    }

    return NextResponse.json({ step, why, whySource: "ai" });
  } catch (err) {
    console.error(
      "[next-step-why] AI failed, using deterministic:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ step, why: fallback.why, whySource: fallback.whySource });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "next-step-why" });
