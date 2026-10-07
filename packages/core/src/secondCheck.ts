/**
 * The second check, provider layer (server only).
 *
 * The writer of a Forge page is a Claude model, so the checker must come from
 * a different model family. The provider is chosen by configuration, not code:
 *
 *   SECOND_CHECK_BASE_URL  an OpenAI-compatible chat API base, ending before
 *                          "/chat/completions"
 *   SECOND_CHECK_MODEL     the model id at that provider
 *   SECOND_CHECK_API_KEY   the key (paid tier only: free tiers may train on
 *                          input, and this is real people's text)
 *
 * When any of the three is missing, or the model is a Claude model, there is
 * no provider and the page uses the mint check alone.
 *
 * Adding a Gemini adapter
 * - Easiest: Gemini serves an OpenAI-compatible endpoint, so the existing
 *   adapter works by pointing SECOND_CHECK_BASE_URL at it and setting
 *   SECOND_CHECK_MODEL to a Gemini model id. No code change.
 * - Native API: write a function that returns a SecondCheckProvider. Its
 *   complete() sends prompt.system as the system instruction and prompt.user
 *   as the one user turn, asks for JSON output, and returns the reply text
 *   plus input and output token counts from the response's usage metadata.
 *   Read the text from the first part that carries text; never assume the
 *   first part does. Throw on any non-2xx reply. Then choose it in
 *   secondCheckProviderFromEnv (for example by a SECOND_CHECK_API_STYLE
 *   value) and add a mock-fetch test like the one for the OpenAI adapter.
 *
 * runSecondCheck never throws: a timeout, an error or an unreadable reply
 * comes back as status "unavailable" with no findings, and the page falls
 * back to the mint check alone.
 */

import {
  buildSecondCheckPrompt,
  parseSecondCheckResponse,
  type SecondCheckFinding,
  type SecondCheckPrompt,
} from "./secondCheckShared";

export interface SecondCheckUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SecondCheckReply {
  text: string;
  usage: SecondCheckUsage;
}

export interface SecondCheckProvider {
  /** Short provider label for logs and the usage ledger. */
  readonly name: string;
  /** The model id, for the usage ledger. */
  readonly model: string;
  complete(prompt: SecondCheckPrompt, opts: { signal: AbortSignal; maxOutputTokens: number }): Promise<SecondCheckReply>;
}

export const SECOND_CHECK_DEFAULT_TIMEOUT_MS = 20_000;
export const SECOND_CHECK_MAX_OUTPUT_TOKENS = 2_000;

/** True for a model in the writer's family. The checker must never be one. */
export function isWriterFamily(model: string, baseUrl = ""): boolean {
  return /claude|anthropic/i.test(model) || /anthropic\.com/i.test(baseUrl);
}

// ---- OpenAI-compatible adapter --------------------------------------------------

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export function openAICompatibleProvider(cfg: OpenAICompatibleConfig): SecondCheckProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    name: "openai-compatible",
    model: cfg.model,
    async complete(prompt, opts) {
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: opts.maxOutputTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
        signal: opts.signal,
      });
      if (!res.ok) throw new Error(`second check provider replied ${res.status}`);
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.find((c) => typeof c?.message?.content === "string")?.message?.content;
      if (typeof content !== "string") throw new Error("second check provider sent no text");
      return {
        text: content,
        usage: {
          inputTokens: Number(data.usage?.prompt_tokens) || 0,
          outputTokens: Number(data.usage?.completion_tokens) || 0,
        },
      };
    },
  };
}

// ---- mock -----------------------------------------------------------------------

/**
 * A provider that never leaves the process. `reply` is the raw model text to
 * return (a string, or a function of the prompt), and `fail` makes it throw.
 * Used by every test and by the offline harness.
 */
export function mockSecondCheckProvider(
  opts: { reply?: string | ((p: SecondCheckPrompt) => string); fail?: boolean; delayMs?: number } = {}
): SecondCheckProvider & { calls: SecondCheckPrompt[] } {
  const calls: SecondCheckPrompt[] = [];
  return {
    name: "mock",
    model: "mock-checker",
    calls,
    async complete(prompt, { signal }) {
      calls.push(prompt);
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
        });
      }
      if (opts.fail) throw new Error("mock provider failure");
      const text = typeof opts.reply === "function" ? opts.reply(prompt) : opts.reply ?? '{"findings":[]}';
      return { text, usage: { inputTokens: Math.ceil((prompt.system.length + prompt.user.length) / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}

// ---- configuration --------------------------------------------------------------

export type ProviderUnavailableReason = "not_configured" | "same_family";

export function secondCheckProviderFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch
): { provider: SecondCheckProvider } | { provider: null; reason: ProviderUnavailableReason } {
  const baseUrl = (env.SECOND_CHECK_BASE_URL || "").trim();
  const model = (env.SECOND_CHECK_MODEL || "").trim();
  const apiKey = (env.SECOND_CHECK_API_KEY || "").trim();
  if (!baseUrl || !model || !apiKey) return { provider: null, reason: "not_configured" };
  if (isWriterFamily(model, baseUrl)) return { provider: null, reason: "same_family" };
  return { provider: openAICompatibleProvider({ baseUrl, model, apiKey, fetchImpl }) };
}

/** True only for an explicit "true" or "1". Off by default. */
export function secondCheckEnabled(env: Record<string, string | undefined>): boolean {
  const v = (env.SECOND_CHECK_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1";
}

// ---- run ------------------------------------------------------------------------

export interface SecondCheckRunInput {
  resumeText: string;
  sourceText: string;
}

export type SecondCheckRunResult =
  | { status: "ran"; findings: SecondCheckFinding[]; dropped: number; reworded: number; usage: SecondCheckUsage }
  | { status: "unavailable"; findings: []; usage: SecondCheckUsage | null };

export async function runSecondCheck(
  input: SecondCheckRunInput,
  provider: SecondCheckProvider,
  opts: { timeoutMs?: number; maxOutputTokens?: number } = {}
): Promise<SecondCheckRunResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The race also covers a provider that ignores the abort signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("second check timed out"));
    }, opts.timeoutMs ?? SECOND_CHECK_DEFAULT_TIMEOUT_MS);
  });
  try {
    const prompt = buildSecondCheckPrompt(input);
    const reply = await Promise.race([
      provider.complete(prompt, {
        signal: controller.signal,
        maxOutputTokens: opts.maxOutputTokens ?? SECOND_CHECK_MAX_OUTPUT_TOKENS,
      }),
      timeout,
    ]);
    const parsed = parseSecondCheckResponse(reply.text, input.resumeText);
    if (!parsed.ok) return { status: "unavailable", findings: [], usage: reply.usage };
    return { status: "ran", findings: parsed.findings, dropped: parsed.dropped, reworded: parsed.reworded, usage: reply.usage };
  } catch {
    return { status: "unavailable", findings: [], usage: null };
  } finally {
    if (timer) clearTimeout(timer);
    timeout.catch(() => undefined);
  }
}
