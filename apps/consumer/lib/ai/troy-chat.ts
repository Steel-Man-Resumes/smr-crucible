/**
 * t.ROY chat on Claude Sonnet 5.5, through the Vercel AI SDK this app pins
 * (ai 4.3 with @ai-sdk/anthropic 1.2). Shared by /api/assistant (both the
 * streamed participant path and the verified org staff path) and /api/coach.
 *
 * What Sonnet 5.5 changed for these routes, and where each one is handled:
 *
 * - Sampling settings. Any non-default temperature, top_p or top_k is an HTTP
 *   400. AI SDK 4 sends temperature 0 when a call sets none, so leaving the
 *   setting off is not enough: troyChatModel() strips all three before the
 *   request is built and the API uses its own defaults.
 * - Thinking. Adaptive thinking is on by default and its tokens count toward
 *   max_tokens even though the text is not returned (display "omitted").
 *   troyMaxTokens() adds headroom so a turn that thinks first is not cut off.
 * - Effort. @ai-sdk/anthropic 1.2 has no effort option: its provider options
 *   accept only `thinking: {type: "enabled" | "disabled", budgetTokens}` (both
 *   400s on Sonnet 5.5) and drop any other key. So the provider gets a custom
 *   fetch, withChatEffort(), that adds output_config.effort "low" to Sonnet 5
 *   request bodies. Without it the API default is "high", which thinks before
 *   almost every reply, even a greeting.
 * - Declines. A safety decline is HTTP 200 with stop_reason "refusal", which
 *   AI SDK 4 reports as finishReason "unknown", usually with no text. These
 *   routes have no second provider to fall back to, so emptyReplyGuard() and
 *   replyOrFallback() put a short line on screen instead of an empty bubble.
 * - No change needed: tool_choice stays at the default ("auto"), there is no
 *   assistant prefill, and thinking blocks never reach the browser
 *   (toDataStreamResponse does not send reasoning by default), so they are
 *   never replayed across turns.
 */

import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import { wrapLanguageModel } from "ai";
import type {
  LanguageModelV1Middleware,
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
} from "ai";
import { MODEL_TROY } from "./models";

/** Removes the sampling settings Sonnet 5.5 rejects, including AI SDK 4's default temperature 0. */
export const omitSamplingSettings: LanguageModelV1Middleware = {
  transformParams: async ({ params }) => ({
    ...params,
    temperature: undefined,
    topP: undefined,
    topK: undefined,
  }),
};

/** Chat effort: short thinking, so the first words arrive sooner. */
export const TROY_EFFORT = "low";

/**
 * A fetch for the Anthropic provider that adds `output_config.effort` to
 * Messages request bodies whose model starts with "claude-sonnet-5". Any other
 * request (another model, a body that is not JSON, one that already sets an
 * effort) is passed on exactly as it came. Never logs the body or headers:
 * they carry the prompt and the API key.
 */
export function withChatEffort(baseFetch?: typeof fetch): typeof fetch {
  return (input, init) => {
    const send = baseFetch ?? globalThis.fetch;
    if (!init || typeof init.body !== "string") return send(input, init);
    let body: { model?: unknown; output_config?: Record<string, unknown> } | null = null;
    try {
      body = JSON.parse(init.body);
    } catch {
      return send(input, init);
    }
    if (
      !body ||
      typeof body.model !== "string" ||
      !body.model.startsWith("claude-sonnet-5") ||
      body.output_config?.effort !== undefined
    ) {
      return send(input, init);
    }
    const withEffort = { ...body, output_config: { ...(body.output_config ?? {}), effort: TROY_EFFORT } };
    return send(input, { ...init, body: JSON.stringify(withEffort) });
  };
}

const troyAnthropic = createAnthropic({ fetch: withChatEffort() });

/**
 * The t.ROY chat model. Use this, not anthropic(MODEL_TROY). The provider
 * argument exists for tests (a fake fetch); routes call it with none.
 */
export function troyChatModel(provider: AnthropicProvider = troyAnthropic) {
  return wrapLanguageModel({
    model: provider(MODEL_TROY),
    middleware: omitSamplingSettings,
  });
}

/**
 * Room for thinking on top of the reply. The old caps (400 to 1200) were sized
 * for the reply alone. Reply length is still set by each prompt's format rules.
 */
export const TROY_THINKING_HEADROOM = 3000;

export function troyMaxTokens(replyTokens: number): number {
  return replyTokens + TROY_THINKING_HEADROOM;
}

/** Shown instead of an empty reply (a safety decline, or a turn that ran out before it said anything). */
export const TROY_EMPTY_REPLY = "I couldn't answer that one. Try asking it another way.";

/** For the non-streamed path: the model's text, or the fallback line when there is none. */
export function replyOrFallback(text: string): string {
  return text.trim() ? text : TROY_EMPTY_REPLY;
}

/**
 * streamText transform: if a step ends without a tool call and nothing has
 * been said in any step, add the fallback line before that step finishes. A
 * step with a tool call is skipped, because either another step follows or the
 * browser carries the turn on (client tools).
 */
export function emptyReplyGuard<TOOLS extends ToolSet>(): StreamTextTransform<TOOLS> {
  return () => {
    let spoke = false;
    let calledTool = false;
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        if (part.type === "text-delta" && part.textDelta.trim()) spoke = true;
        if (part.type === "tool-call") calledTool = true;
        if (part.type === "step-finish") {
          if (!spoke && !calledTool) {
            controller.enqueue({ type: "text-delta", textDelta: TROY_EMPTY_REPLY });
            spoke = true;
          }
          calledTool = false;
        }
        controller.enqueue(part);
      },
    });
  };
}

/**
 * Refinery coach: the "How creative should your coach be?" slider (0-100,
 * default 50) used to set temperature. Sonnet 5.5 rejects any non-default
 * temperature, so the setting now reaches the coach as an instruction. The
 * middle of the range adds nothing, so the default prompt is unchanged.
 */
export function coachCreativityNote(creativity: number): string {
  if (creativity <= 33) {
    return `

## Creativity setting: focused
This person asked for focused advice. Stick to the most common, proven path and concrete steps. Do not brainstorm alternatives unless they ask.`;
  }
  if (creativity >= 67) {
    return `

## Creativity setting: exploratory
This person asked for a more exploratory coach. When it helps, offer one less obvious option or angle next to the standard advice, and say which is which.`;
  }
  return "";
}
