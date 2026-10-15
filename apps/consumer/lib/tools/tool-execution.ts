/** Request-local result reuse and hard execution budget. Never retries a mutation. */
export function executionBudget(limit = 8) {
  let used = 0;
  const calls = new Map<string, Promise<unknown>>();
  const canonical = (value: unknown): string => {
    if (!value || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  };
  return (name: string, args: unknown, run: () => Promise<unknown>): Promise<unknown> => {
    const key = `${name}:${canonical(args)}`;
    if (calls.has(key)) return calls.get(key)!;
    if (used >= limit) return Promise.resolve({ status: "blocked", error: "This turn reached its tool limit. Explain the results already received and ask which next step to take." });
    used++;
    const call = Promise.resolve().then(run);
    calls.set(key, call);
    return call;
  };
}
