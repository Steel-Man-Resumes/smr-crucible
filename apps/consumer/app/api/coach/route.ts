import { beginChatOperation } from "@/lib/ai-chat-operation";
import { assistantStepUsage } from "@/lib/ai/assistant-step-usage";
import { assistantCapabilities } from "@/lib/assistant-capabilities";
/**
 * AI Career Coach -- streaming, profile-aware, persistent (master plan Section 5).
 *
 * Authenticated only. This is the in-Refinery, user-named coach (distinct from
 * t.ROY, which stays on the Forge/public surface). It accepts the AI SDK useChat
 * shape ({ messages }) so it is a drop-in for the existing chat drawer, builds a
 * profile-aware system prompt from getUserProfile, streams Claude Sonnet 5.5
 * (MODEL_TROY, built by lib/ai/troy-chat),
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
import { auth } from "@/auth";
import { forgeUserId } from "@/lib/session-policy";
import { effectiveAuth } from "@/lib/effective-auth";
import { loadSelectedWork, selectedWorkPrompt } from "@/lib/assistant-work-context";
import { sanitizeOrEmpty } from "@/lib/sanitize";
import { loadSkillsForContext } from "@/lib/skills-loader";
import { MODEL_TROY } from "@/lib/ai/models";
import { TROY_SERVER_MAX_STEPS, firstStepIndex } from "@/lib/ai/troy-steps";
import {
  troyChatModel,
  troyMaxTokens,
  emptyReplyGuard,
  coachCreativityNote,
} from "@/lib/ai/troy-chat";
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

const MODEL = MODEL_TROY;
const RATE_LIMIT_MESSAGE =
  "You've used all your free coach messages for today. Come back tomorrow, or enter a partner code in Settings for more.";

/** GET -> stored conversation, so the chat UI can hydrate on open. */
export async function GET() {
  const session = await auth();
  const userId = forgeUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const history = await loadCoachHistory(userId, 50);
  return NextResponse.json({ data: history.filter((m) => m.role !== "system") });
}

// No live lookup tool: the coach cannot check current law, so it must not
// present law as settled. Kept here, next to the tool list it compensates for.
const CURRENT_LAW_NOTE = `

## Current law
You can read the published employer and resource tools, but you cannot verify current law on the open web. When an answer depends on current law or policy (ban-the-box, expungement or sealing, WOTC, licensing, a program's status), say that the rules vary by place and change over time, and point the person to the official state or city source or a local legal aid office to confirm. Never state law as settled.`;

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = forgeUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const effective = await effectiveAuth();
  if (effective?.user?.id !== userId) return NextResponse.json({ error: "Coach is unavailable while viewing as someone." }, { status: 403 });
  if (await (await import("@crucible/core")).isPlatformAdmin(userId)) return NextResponse.json({ error: "Use the platform assistant for owner operations." }, { status: 403 });
  const actor = await (await import("@crucible/core")).resolveOrgActor(userId);
  if (actor) return NextResponse.json({ error: "Use the staff assistant for organization work." }, { status: 403 });

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
  const ctx = (body?.context ?? {}) as { currentPage?: string; selectedWork?: unknown };
  const page = typeof ctx.currentPage === "string" ? ctx.currentPage : "dashboard";
  const hasCriminalRecord = profile.barriers.includes("criminal_record");
  const skillsContext = loadSkillsForContext(page, hasCriminalRecord);
  let selectedWork;
  try { selectedWork = await loadSelectedWork(userId, ctx.selectedWork); }
  catch { return NextResponse.json({ error: "The selected work could not be loaded. Reopen your lane or document and try again." }, { status: 409 }); }
  const access = await (await import("@crucible/core")).getPremiumAccess(userId);
  const toolOptions = { userId, surface: "refinery" as const, selectedWork };
  // "enhanced" consent gates all memory personalization (read AND write).
  // Absent row defaults to granted (see consentDefaultFor doctrine), so this
  // is a no-op for every user until someone actually revokes it. Computed
  // once so the read and both writes below agree within one request.
  const enhancedConsent = await isConsentGranted(userId, "enhanced");
  // Memory loads BEFORE the current user turn is persisted, so the section
  // holds prior work, not an echo of what was just typed.
  const memorySection = enhancedConsent ? await buildMemorySection(userId) : "";
  const tools = buildAssistantTools(toolOptions);
  const capabilities = assistantCapabilities(tools, { role: "participant", page, signedIn: true, hasCriminalRecord });
  const systemPrompt =
    buildCoachSystemPrompt(profile) +
    skillsContext +
    selectedWorkPrompt(selectedWork) +
    "\nCURRENT CAPABILITIES: " + JSON.stringify(capabilities) +
    "\nSERVER ACCESS (each operation still checks policy): " + JSON.stringify({ role: "participant", open: access.open }) +
    buildHandsSection(toolOptions) +
    CURRENT_LAW_NOTE +
    coachCreativityNote(profile.coachCreativity) +
    memorySection;

  // Persist the newest user turn for cross-session memory -- but ONLY when the
  // newest message is the user speaking. A client-tool continuation POST ends
  // with an assistant tool-result message; persisting there would double-insert
  // the previous user turn.
  // Stored rows use sanitizeOrEmpty and are tested after sanitizing, so a
  // blank or whitespace-only turn is never saved (and never as a label).
  const userTurnText = lastUserText(messages);
  const storedTurn = sanitizeOrEmpty(userTurnText, 4000);
  if (enhancedConsent && endsWithUserTurn(messages) && storedTurn) {
    await appendCoachMessage(userId, "user", storedTurn);
  }

  const startTime = Date.now();

  const operation = await beginChatOperation(userId ?? null, "coach", MODEL);
  if (operation.response) return operation.response;
  return operation.run(async () => {
  try {
  const result = streamText({
    model: troyChatModel(),
    system: systemPrompt,
    messages: messages as never,
    // Reply budget by the length setting, plus room for Sonnet 5.5's thinking.
    // The prompt's length rule still sets how long the reply is.
    maxTokens: troyMaxTokens(profile.coachLength === "brief" ? 400 : 700),
    tools,
    maxSteps: TROY_SERVER_MAX_STEPS,
    toolCallStreaming: true,
    async onStepFinish({ usage, providerMetadata }) {
      await operation.run(async () => {
      const { recordTokenUsage } = await import("@/lib/ai-usage-log");
      await recordTokenUsage("anthropic", MODEL, assistantStepUsage(usage, providerMetadata), { userId: userId ?? null, endpoint: "coach" });
      });
    },
    async onError() { await operation.fail(); },
    experimental_transform: emptyReplyGuard({ firstStep: firstStepIndex(messages) }),
    async onFinish({ text, usage, finishReason, steps }) {
      await operation.run(async () => {
      try {
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
      } finally { await operation.finish(); }
      });
    },
  });

  return result.toDataStreamResponse();
  } catch (error) { await operation.fail(); throw error; }
  });
}
