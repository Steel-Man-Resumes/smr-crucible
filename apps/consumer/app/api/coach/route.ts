/**
 * AI Career Coach -- streaming, profile-aware, persistent (master plan Section 5).
 *
 * Authenticated only. This is the in-Refinery, user-named coach (distinct from
 * t.ROY, which stays on the Forge/public surface). It loads the user's full
 * profile before the first token, adapts tone to their coach settings, persists
 * the conversation, and logs every turn for observability.
 */

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/auth";
import { sanitizeForPrompt } from "@/lib/sanitize";
import {
  getUserProfile,
  buildCoachSystemPrompt,
  loadCoachHistory,
  appendCoachMessage,
  getUserDailyLimit,
  incrementUserUsage,
} from "@crucible/core";

export const maxDuration = 30;

const MODEL = "claude-sonnet-4-6";
const RATE_LIMIT_MESSAGE =
  "You've used all your free coach messages for today. Come back tomorrow, or enter a partner code in Settings for more.";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Daily quota (atomic increment-then-check), action "coach"
  const limit = await getUserDailyLimit(userId);
  const newCount = await incrementUserUsage(userId, "coach");
  if (limit !== 0 && newCount > limit) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const userMessage = typeof body?.message === "string" ? body.message.trim() : "";
  if (!userMessage) {
    return NextResponse.json({ error: "No message provided" }, { status: 400 });
  }

  const profile = await getUserProfile(userId);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const systemPrompt = buildCoachSystemPrompt(profile);
  const history = await loadCoachHistory(userId, 50);
  const cleanMessage = sanitizeForPrompt(userMessage, 4000);

  // Persist the user turn before generating, so it survives a stream drop.
  await appendCoachMessage(userId, "user", cleanMessage);

  const messages = [
    ...history
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: cleanMessage },
  ];

  const startTime = Date.now();

  const result = streamText({
    model: anthropic(MODEL),
    system: systemPrompt,
    messages,
    maxTokens: profile.coachLength === "brief" ? 220 : 600,
    temperature: Math.min(Math.max(profile.coachCreativity / 100, 0), 1),
    async onFinish({ text, usage }) {
      try {
        await appendCoachMessage(userId, "assistant", text);
      } catch (err) {
        console.error("Coach persist failed:", err);
      }
      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          userId,
          sessionId: null,
          contextPage: "coach",
          modelProvider: "anthropic",
          modelId: MODEL,
          input: cleanMessage,
          explanation: `Coach (${profile.coachName}) responded at journey stage ${profile.currentStage}.`,
          outputSummary: { response_length: text.length },
          tokenCount: usage?.totalTokens ?? null,
          latencyMs: Date.now() - startTime,
        });
      } catch (err) {
        console.error("Coach decision log failed:", err);
      }
    },
  });

  return result.toDataStreamResponse();
}
