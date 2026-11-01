/** Keep verifier accounting even when its structured answer cannot be used. */
export interface VerificationUsage { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; }
export function verificationUsage(value: unknown): VerificationUsage {
  const u = value as {prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: {cached_tokens?: unknown}} | undefined;
  const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NaN;
  const total = count(u?.prompt_tokens), output = count(u?.completion_tokens);
  const cached = u?.prompt_tokens_details?.cached_tokens === undefined ? 0 : count(u.prompt_tokens_details.cached_tokens);
  return { inputTokens: cached <= total ? total - cached : NaN, outputTokens: output, cacheReadInputTokens: cached };
}
interface Dependencies {
  fetch: typeof fetch;
  /** Time this call may take; the route passes what is left before its deadline (default 30 s). */
  timeoutMs?: number;
  record(usage: VerificationUsage, meta: {outcome: "failed" | "succeeded"; usageMissing: boolean}): Promise<unknown>;
}
export async function runOrgVerificationCall(model: string, prompt: string, key: string, deps: Dependencies): Promise<string[] | null> {
  let recorded = false;
  try {
    const res = await deps.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${key}`},
      body: JSON.stringify({model, messages: [{role: "user", content: prompt}], temperature: 0, max_tokens: 900, response_format: {type: "json_object"}}),
      // No user-facing timeouts (Troy 11/01): a slow check waits behind the working state, up to 30 s or the
      // time the route has left before maxDuration, whichever is less (pre-merge review F5).
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(30_000, deps.timeoutMs ?? 30_000))),
    });
    const data = await res.json();
    const usage = verificationUsage(data?.usage);
    const usageMissing = !Object.values(usage).every(Number.isFinite);
    recorded = true;
    await deps.record(usage, {outcome: res.ok ? "succeeded" : "failed", usageMissing});
    if (!res.ok) return null;
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "") as {sentences?: unknown};
    if (!Array.isArray(parsed?.sentences)) return null;
    return (parsed.sentences as Array<{text?: unknown; kind?: unknown; supported?: unknown}>)
      .filter((x) => x?.kind === "claim" && x?.supported === false && typeof x?.text === "string")
      .map((x) => x.text as string);
  } catch {
    if (!recorded) {
      recorded = true;
      await deps.record({inputTokens: NaN, outputTokens: NaN, cacheReadInputTokens: 0}, {outcome: "failed", usageMissing: true});
    }
    return null;
  }
}
