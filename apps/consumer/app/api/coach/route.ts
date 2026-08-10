/**
 * AI Career Coach -- streaming, profile-aware, persistent (master plan Section 5).
 *
 * Authenticated only. This is the in-Refinery, user-named coach (distinct from
 * t.ROY, which stays on the Forge/public surface). It accepts the AI SDK useChat
 * shape ({ messages }) so it is a drop-in for the existing chat drawer, builds a
 * profile-aware system prompt from getUserProfile, streams claude-sonnet-4-6,
 * persists each new turn to coach_conversation, and logs for observability.
 *
 * 10x wave: hands (shared tool factory), messages pass through unstripped so
 * client-executed tool invocations survive the round-trip. Persistence dedupe:
 * a client-tool continuation POST re-sends the thread, so the user turn is
 * only persisted when the newest message IS a user turn, and the assistant
 * turn is only persisted when the model actually finished speaking (not on
 * finishReason "tool-calls").
 */

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/auth";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { loadSkillsForContext } from "@/lib/skills-loader";
import { MODEL_CHAT } from "@/lib/ai/models";
import { webSearchTool } from "@/lib/tools/web-search";
import {
  buildAssistantTools,
  buildHandsSection,
  pluckMessages,
  lastUserText,
  endsWithUserTurn,
} from "@/lib/tools/assistant-tools";
import {
  getUserProfile,
  buildCoachSystemPrompt,
  buildMemorySection,
  appendCoachMessage,
  loadCoachHistory,
  getUserDailyLimit,
  incrementUserUsage,
  isConsentGranted,
} from "@crucible/core";

// Tool round-trips (job search + enrichment can take 10-20s cold) need more
// than the old 30s ceiling.
export const maxDuration = 60;

const MODEL = MODEL_CHAT;
const RATE_LIMIT_MESSAGE =
  "You've used all your free coach messages for today. Come back tomorrow, or enter a partner code in Settings for more.";

/** GET -> stored conversation, so the chat UI can hydrate on open. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const history = await loadCoachHistory(userId, 50);
  return NextResponse.json({ data: history.filter((m) => m.role !== "system") });
}

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
  const messages = pluckMessages(body?.messages);

  if (!messages.length) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const profile = await getUserProfile(userId);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Bring Troy's doctrine (disclosure + career-narrative) into the authenticated
  // coach -- buildCoachSystemPrompt gives profile awareness; the skill files give
  // the coaching methodology; the hands section gives tool doctrine.
  const ctx = (body?.context ?? {}) as { currentPage?: string };
  const page = typeof ctx.currentPage === "string" ? ctx.currentPage : "dashboard";
  const hasCriminalRecord = profile.barriers.includes("criminal_record");
  const skillsContext = loadSkillsForContext(page, hasCriminalRecord);
  const toolOptions = { userId, surface: "refinery" as const };
  // "enhanced" consent gates all memory personalization (read AND write).
  // Absent row defaults to granted (see consentDefaultFor doctrine), so this
  // is a no-op for every user until someone actually revokes it. Computed
  // once so the read and both writes below agree within one request.
  const enhancedConsent = await isConsentGranted(userId, "enhanced");
  // Memory loads BEFORE the current user turn is persisted, so the section
  // holds prior work, not an echo of what was just typed.
  const memorySection = enhancedConsent ? await buildMemorySection(userId) : "";
  const systemPrompt =
    buildCoachSystemPrompt(profile) +
    skillsContext +
    buildHandsSection(toolOptions) +
    memorySection;

  // Persist the newest user turn for cross-session memory -- but ONLY when the
  // newest message is the user speaking. A client-tool continuation POST ends
  // with an assistant tool-result message; persisting there would double-insert
  // the previous user turn.
  const userTurnText = lastUserText(messages);
  if (enhancedConsent && endsWithUserTurn(messages) && userTurnText) {
    await appendCoachMessage(userId, "user", sanitizeForPrompt(userTurnText, 4000));
  }

  const startTime = Date.now();

  const result = streamText({
    model: anthropic(MODEL),
    system: systemPrompt,
    messages: messages as never,
    maxTokens: profile.coachLength === "brief" ? 400 : 700,
    temperature: Math.min(Math.max(profile.coachCreativity / 100, 0), 1),
    tools: {
      ...buildAssistantTools(toolOptions),
      web_search: webSearchTool,
    },
    maxSteps: 4,
    toolCallStreaming: true,
    async onFinish({ text, usage, finishReason, steps }) {
      // Exact token accounting (in multi-step runs `usage` is the combined
      // total of all steps in this request)
      if (usage) {
        try {
          const { recordTokenUsage } = await import("@/lib/ai-usage-log");
          recordTokenUsage(
            "anthropic",
            MODEL,
            {
              inputTokens: (usage as any).promptTokens || 0,
              outputTokens: (usage as any).completionTokens || 0,
            },
            { userId, endpoint: "coach" }
          );
        } catch (err) {
          console.error("Coach token accounting failed:", err);
        }
      }

      // Persist the assistant turn only when the model finished SPEAKING.
      // finishReason "tool-calls" means the turn continues in the browser
      // (client-executed tool); the continuation request persists the reply.
      if (enhancedConsent && finishReason !== "tool-calls") {
        const spoken = (steps ?? [])
          .map((s) => s.text)
          .filter(Boolean)
          .join("\n\n") || text;
        if (spoken.trim()) {
          try {
            await appendCoachMessage(userId, "assistant", spoken);
          } catch (err) {
            console.error("Coach persist failed:", err);
          }
        }
      }

      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          userId,
          sessionId: null,
          contextPage: "coach",
          modelProvider: "anthropic",
          modelId: MODEL,
          input: userTurnText,
          explanation: `Coach (${profile.coachName}) responded at journey stage ${profile.currentStage}.`,
          outputSummary: { response_length: text.length, finish_reason: finishReason },
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
