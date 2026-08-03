/**
 * Shared AI call helper -- Anthropic primary, OpenAI fallback.
 *
 * Troy's locked decision (2026-06-07): coaching/generation quality comes from
 * Anthropic, with OpenAI as a resilience fallback (the same failover doctrine
 * used across t.ROY). Default model: MODEL_CHAT (Sonnet 4.6). Fallback: gpt-4o.
 *
 * The single switch point for all 8 consumer AI routes -- callers use callAI()
 * unchanged. A caller may pass an explicit `model` (e.g. MODEL_DEEP for the
 * high-stakes one-shot synthesis routes) without changing any other call site.
 * MOCK_AI is handled upstream in the routes (mock-ai.ts), so this helper is only
 * reached on real calls.
 *
 * AI_PROVIDER / AI_MODEL are the decision-log labels for the PRIMARY path. On a
 * fallback to OpenAI the underlying call differs from these labels; that is the
 * rare exception path and is logged to the server console.
 */

import { MODEL_CHAT, FALLBACK_CHAT } from "./ai/models";
import { recordTokenUsage, type AiCallMeta } from "./ai-usage-log";

export const AI_PROVIDER = "anthropic";
export const AI_MODEL = MODEL_CHAT;
export const AI_FALLBACK_PROVIDER = "openai";
export const AI_FALLBACK_MODEL = FALLBACK_CHAT;

const ANTHROPIC_VERSION = "2023-06-01";

type Msg = { role: string; content: string };

async function callAnthropic(
  system: string,
  messages: Msg[],
  maxTokens: number,
  model: string,
  meta?: AiCallMeta
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Anthropic takes `system` as a top-level field; messages must be user/assistant only.
  const body = {
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const data = await response.json();

  // Exact token accounting -- Anthropic reports real usage on every response.
  if (data.usage) {
    recordTokenUsage(
      "anthropic",
      data.model || model,
      {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        cacheCreationInputTokens: data.usage.cache_creation_input_tokens || 0,
        cacheReadInputTokens: data.usage.cache_read_input_tokens || 0,
      },
      meta
    );
  }

  const text =
    Array.isArray(data.content) &&
    data.content.find((b: { type?: string }) => b.type === "text")?.text;
  return text || "";
}

async function callOpenAI(
  system: string,
  messages: Msg[],
  maxTokens: number,
  meta?: AiCallMeta
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const allMessages: Msg[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_FALLBACK_MODEL,
      max_tokens: maxTokens,
      messages: allMessages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = await response.json();

  if (data.usage) {
    recordTokenUsage(
      "openai",
      data.model || AI_FALLBACK_MODEL,
      {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      },
      meta
    );
  }

  return data.choices[0]?.message?.content || "";
}

export async function callAI(
  system: string,
  messages: Msg[],
  maxTokens = 2048,
  model: string = AI_MODEL,
  meta?: AiCallMeta
): Promise<string> {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic) {
    try {
      return await callAnthropic(system, messages, maxTokens, model, meta);
    } catch (err) {
      if (!hasOpenAI) throw err;
      console.error(
        "[ai-call] Anthropic failed, falling back to OpenAI:",
        err instanceof Error ? err.message : err
      );
      return await callOpenAI(system, messages, maxTokens, meta);
    }
  }

  if (hasOpenAI) return await callOpenAI(system, messages, maxTokens, meta);

  throw new Error("No AI provider key set (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
}
