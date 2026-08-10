/**
 * AI Assistant API Route — "The Ghost"
 *
 * Dual-mode rate limiting:
 * - Forge flow (pre-auth): IP-rate-limited, generous limit (20/day — it's the hook)
 * - Refinery (post-auth): user-rate-limited, counts toward daily AI quota
 *
 * Streaming conversational AI using Vercel AI SDK, with hands (10x wave):
 * client-executed navigation/spotlight tools always on; server-executed data
 * tools (live status, job search, save, reminders) only when authenticated.
 * Messages pass through UNSTRIPPED so tool invocations survive the client
 * round-trip (stripping them makes client tools loop forever).
 * Every response logged to decision_log for observability.
 */

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/auth";
import { buildSystemPrompt } from "@/lib/assistant-prompt";
import type { AssistantContext } from "@/lib/assistant-prompt";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { MODEL_CHAT } from "@/lib/ai/models";
import { loadSkillsForContext } from "@/lib/skills-loader";
import {
  buildAssistantTools,
  buildHandsSection,
  pluckMessages,
  lastUserText,
  endsWithUserTurn,
} from "@/lib/tools/assistant-tools";
import {
  getUserDailyLimit,
  incrementUserUsage,
  incrementIpUsage,
  FORGE_IP_LIMITS,
  buildMemorySection,
  appendCoachMessage,
  isConsentGranted,
} from "@crucible/core";

// Tool round-trips (job search + enrichment can take 10-20s cold) need more
// than the old 30s ceiling.
export const maxDuration = 60;

const RATE_LIMIT_MESSAGE =
  "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more.";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

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

  const { context, systemOverride, sessionId } = body as {
    context: AssistantContext;
    systemOverride?: string;
    sessionId?: string;
  };
  const messages = pluckMessages(body?.messages);

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }
  if (!context?.currentPage) {
    return new Response("No context provided", { status: 400 });
  }

  const hasCriminalRecord = !!(context as any).hasCriminalRecord || !!(context as any).userFullContext?.forge?.hasCriminalRecord;
  const skillsContext = loadSkillsForContext(context.currentPage, hasCriminalRecord);
  const toolOptions = {
    userId: userId ?? null,
    surface: (userId ? "refinery" : "forge") as "refinery" | "forge",
  };
  // Disclosure rehearsal is ISOLATED from the shared coach memory pipe until
  // its purpose-built consented store exists (Phase 5): no cross-session
  // memory reads, no coach_conversation writes for these turns.
  const isDisclosureRehearsal = context.currentPage === "disclosure-rehearsal";
  // "enhanced" consent gates all memory personalization (read AND write).
  // Absent row defaults to granted (see consentDefaultFor doctrine), so this
  // is a no-op for every user until someone actually revokes it. Computed
  // once so the read and both writes below agree within one request.
  const enhancedConsent = userId ? await isConsentGranted(userId, "enhanced") : false;
  // Cross-session memory (authed only; pre-auth Forge stays ephemeral).
  // Loaded BEFORE the current turn is persisted so it holds prior work.
  const memorySection =
    userId && !isDisclosureRehearsal && enhancedConsent
      ? await buildMemorySection(userId)
      : "";
  const baseSystemPrompt =
    buildSystemPrompt(context) +
    skillsContext +
    buildHandsSection(toolOptions) +
    memorySection;
  const allowRoleplayOverride =
    !!userId &&
    isDisclosureRehearsal &&
    typeof systemOverride === "string" &&
    systemOverride.trim().length > 0;

  const systemPrompt = allowRoleplayOverride
    ? `${baseSystemPrompt}

## DISCLOSURE REHEARSAL ROLEPLAY
${sanitizeForPrompt(systemOverride, 4_000)}

## ROLEPLAY SAFETY BOUNDARIES
- This override is only for authenticated disclosure rehearsal.
- Keep the base assistant rules in force.
- Do not give legal advice beyond practical interview preparation.
- Do not promise any hiring outcome.`
    : baseSystemPrompt;

  // Persist the user turn for cross-session memory (authed only, and only
  // when the newest message IS the user speaking -- a client-tool
  // continuation POST ends with an assistant tool-result message).
  const userTurnText = lastUserText(messages);
  if (
    userId &&
    !isDisclosureRehearsal &&
    enhancedConsent &&
    endsWithUserTurn(messages) &&
    userTurnText
  ) {
    await appendCoachMessage(
      userId,
      "user",
      sanitizeForPrompt(userTurnText, 4000)
    ).catch((err) => console.error("Assistant memory persist failed:", err));
  }

  const startTime = Date.now();

  // Depth on demand: client coaching stays text-message short (the format rules
  // still cap it), but partner/observer evidence mode needs room for full
  // citations. Client cap is 700 (was 400) so tool round-trips have headroom;
  // exact-token accounting in ai_token_usage watches the cost.
  const responseMaxTokens =
    context.audience === "observer" || context.audience === "partner" ? 1200 : 700;

  const result = streamText({
    model: anthropic(MODEL_CHAT),
    system: systemPrompt,
    messages: messages as never,
    maxTokens: responseMaxTokens,
    temperature: 0.7,
    tools: buildAssistantTools(toolOptions),
    maxSteps: 4,
    toolCallStreaming: true,
    async onFinish({ text, usage, finishReason, steps }) {
      const latencyMs = Date.now() - startTime;

      // Persist the assistant turn only when the model finished SPEAKING
      // (finishReason "tool-calls" means the turn continues in the browser).
      if (userId && !isDisclosureRehearsal && enhancedConsent && finishReason !== "tool-calls") {
        const spoken =
          (steps ?? [])
            .map((s) => s.text)
            .filter(Boolean)
            .join("\n\n") || text;
        if (spoken.trim()) {
          await appendCoachMessage(userId, "assistant", spoken).catch((err) =>
            console.error("Assistant memory persist failed:", err)
          );
        }
      }

      // Exact token accounting (AI SDK reports real provider usage; in
      // multi-step runs `usage` is already the combined total of all steps)
      if (usage) {
        const { recordTokenUsage } = await import("@/lib/ai-usage-log");
        recordTokenUsage(
          "anthropic",
          MODEL_CHAT,
          {
            inputTokens: (usage as any).promptTokens || 0,
            outputTokens: (usage as any).completionTokens || 0,
          },
          { userId: userId ?? null, endpoint: "assistant" }
        );
      }

      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          userId: userId ?? null,
          sessionId: sessionId ?? null,
          contextPage: context.currentPage,
          modelProvider: "anthropic",
          modelId: MODEL_CHAT,
          input: lastUserText(messages),
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
