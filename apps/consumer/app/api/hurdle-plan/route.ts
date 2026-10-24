/**
 * Hurdle plan wording. POST { selected, answers, recordConsent, targetJob?, strengths? }
 *
 * The plan itself is built in the browser from the answers (lib/hurdles/plan.ts)
 * and needs no AI. This route only puts the person's own answers into smoother
 * words, then strips any sentence that adds a fact (lib/hurdles/fact-check.ts).
 * It runs through the shared AI admission and quota (withRateLimit with the
 * disclosure workflow), callAI's Anthropic-then-OpenAI failover, and returns a
 * plain error code on every failure so the page can say what happened.
 * Record answers are refused unless the person's stored record planner
 * consent (migration 095) is granted at the current version; each such call
 * logs the consent version (no content). Nothing the person said is stored here.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { callAI } from "@/lib/ai-call";
import { MODEL_CHAT } from "@/lib/ai/models";
import { isMockEnabled } from "@/lib/mock-ai";
import { hasRecordContent, mockPhraseReply, phraseHurdlePlan, readPhraseRequest } from "@/lib/hurdles/phrase";
import { recordPlannerConsent, RECORD_PLANNER_CONSENT_VERSION } from "@/lib/hurdles/consent-server";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 64_000) return NextResponse.json({ code: "too_large", error: "Too much to send at once." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "bad_request", error: "The plan could not be read. Try again." }, { status: 400 }); }
  const req = readPhraseRequest(body);
  if (!req) return NextResponse.json({ code: "bad_request", error: "Pick at least one hurdle first." }, { status: 400 });

  const session = await auth();
  const userId = session?.user?.id;
  const mock = isMockEnabled();
  // Record content only with the person's stored yes at the current version.
  // The request body cannot turn this on.
  const withRecord = hasRecordContent(req);
  if (withRecord) {
    let consent = { granted: false, version: null as string | null };
    try { if (userId) consent = await recordPlannerConsent(userId); }
    catch { return NextResponse.json({ code: "consent_unavailable", error: "Your answer about record answers could not be checked. Nothing was sent. Try again." }, { status: 503 }); }
    if (!consent.granted) return NextResponse.json({ code: "consent_required", error: "Record answers need your yes before they go to an AI service. Nothing was sent." }, { status: 403 });
    req.recordConsent = true;
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId: userId ?? null, contextPage: "hurdle-plan", modelProvider: mock ? "mock" : "anthropic-or-openai", modelId: MODEL_CHAT,
        input: JSON.stringify({ hurdles: req.selected, consentVersion: RECORD_PLANNER_CONSENT_VERSION }).slice(0, 500),
        explanation: "Worded hurdle plan with record answers under the stored record planner consent. Counts only, no content.",
        outputSummary: { type: "hurdle_plan_wording", record_consent: true, consent_version: RECORD_PLANNER_CONSENT_VERSION },
      });
    } catch { console.error("Decision log failed (hurdle-plan)"); }
  }
  if (!mock && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ code: "ai_unavailable", error: "The AI wording is not available right now. Your plan is built from your answers and is complete without it." }, { status: 503 });
  }
  try {
    const result = await phraseHurdlePlan(req, (system, user) =>
      mock ? Promise.resolve(mockPhraseReply(req)) : callAI(system, [{ role: "user", content: user }], 900, MODEL_CHAT, { userId, endpoint: "disclosure" }, AbortSignal.timeout(25_000))
    );
    return NextResponse.json({ status: result.status, phrasing: result.phrasing, strippedCount: result.stripped.length });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error("HURDLE_PLAN_PHRASE_FAILED", { timeout });
    return NextResponse.json({ code: timeout ? "timeout" : "ai_failed", error: timeout ? "The AI wording took too long. Your plan is built from your answers. Try the wording again." : "The AI wording did not come through. Your plan is built from your answers. Try the wording again." }, { status: 502 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "disclosure", requiredTier: "client" });
