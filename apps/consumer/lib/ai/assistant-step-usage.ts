/** AI SDK 4 Anthropic promptTokens excludes cache counts; retain provider metadata. */
export function assistantStepUsage(usage: { promptTokens?: number; completionTokens?: number }, metadata: unknown) {
  const provider = (metadata as { anthropic?: Record<string, unknown> } | undefined)?.anthropic;
  const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  return {
    inputTokens: count(usage.promptTokens), outputTokens: count(usage.completionTokens),
    cacheCreationInputTokens: count(provider?.cacheCreationInputTokens), cacheReadInputTokens: count(provider?.cacheReadInputTokens),
  };
}
