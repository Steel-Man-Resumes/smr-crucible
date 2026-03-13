/**
 * AI Assistant API Route — "The Ghost"
 *
 * Dual-mode rate limiting:
 * - Forge flow (pre-auth): IP-rate-limited, generous limit (20/day — it's the hook)
 * - Refinery (post-auth): user-rate-limited, counts toward daily AI quota
 *
 * Streaming conversational AI using Vercel AI SDK.
 * Every response logged to decision_log for observability.
 */

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/auth";
import { buildSystemPrompt } from "@/lib/assistant-prompt";
import type { AssistantContext } from "@/lib/assistant-prompt";
import {
  getUserDailyLimit,
  incrementUserUsage,
  incrementIpUsage,
  FORGE_IP_LIMITS,
} from "@crucible/core";

export const maxDuration = 30;

const RATE_LIMIT_MESSAGE =
  "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more.";

export async function POST(request: Request) {
  // Detect auth state for dual-mode rate limiting
  const session = await auth();
  const userId = session?.user?.id;

  if (userId) {
    // Authenticated: user-rate-limited (atomic increment-then-check)
    const limit = await getUserDailyLimit(userId);
    const newCount = await incrementUserUsage(userId, "assistant");
    if (limit !== 0 && newCount > limit) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  } else {
    // Pre-auth (Forge flow): IP-rate-limited (atomic increment-then-check)
    // Use x-real-ip (Vercel edge, not spoofable), fall back to last x-forwarded-for value
    const realIp = request.headers.get("x-real-ip")?.trim();
    const forwarded = request.headers.get("x-forwarded-for");
    const lastForwarded = forwarded ? forwarded.split(",").pop()?.trim() : undefined;
    const ip = realIp || lastForwarded || "unknown";

    const limit = FORGE_IP_LIMITS["assistant"] ?? 20;
    const newCount = await incrementIpUsage(ip, "assistant");
    if (newCount > limit) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  }

  const body = await request.json();

  const { messages, context } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    context: AssistantContext;
  };

  if (!messages?.length) {
    return new Response("No messages provided", { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(context);

  const startTime = Date.now();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages,
    maxTokens: 200,
    temperature: 0.7,
    async onFinish({ text, usage }) {
      const latencyMs = Date.now() - startTime;

      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          userId: userId ?? null,
          sessionId: body.sessionId ?? null,
          contextPage: context.currentPage,
          modelProvider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
          input: messages[messages.length - 1]?.content ?? "",
          explanation: `Assistant responded on ${context.currentPage} page. ${
            context.readinessStage
              ? `User readiness: ${context.readinessStage}.`
              : ""
          }`,
          outputSummary: {
            response_length: text.length,
            word_count: text.split(/\s+/).length,
          },
          tokenCount: usage?.totalTokens ?? null,
          latencyMs,
        });
      } catch (err) {
        console.error("Decision log failed:", err);
      }
    },
  });

  return result.toDataStreamResponse();
}
