/** Owner tools expose aggregate operational facts, never per-person usage or raw coverage submissions. */
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
function pick(value: unknown, keys: readonly string[]) {
  const source = row(value), result: Row = {};
  for (const key of keys) {
    const v = source[key];
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) result[key] = v;
    else if (typeof v === "string") result[key] = v.slice(0, 300);
  }
  return result;
}
const SUM_FIELDS = ["calls", "input_tokens", "output_tokens", "audio_seconds", "cost_usd", "estimated_usd", "unpriced_calls", "legacy_calls", "failed_calls"] as const;
export function ownerCostSummary(report: unknown) {
  const r = row(report);
  const rows = (key: string, keys: readonly string[]) => Array.isArray(r[key]) ? r[key].slice(0, 30).map((v) => pick(v, keys)) : [];
  return {
    status: "ok", readAt: new Date().toISOString(), ...pick(r, ["days", "pricingAsOf", "note"]),
    totals: pick(r.totals, SUM_FIELDS), perEndpoint: rows("perEndpoint", ["endpoint", ...SUM_FIELDS]),
    perWorkflow: rows("perWorkflow", ["workflow", ...SUM_FIELDS]),
    operations: rows("operations", ["workflow", "status", "operations", "without_usage", "incomplete_accounting", "reserved_usd"]),
    limits: "Breakdowns show up to 30 rows each. Totals include the whole requested period. Missing or unpriced usage is not zero cost.",
    href: "/dashboard/admin", writesAvailable: false,
  };
}
export interface OwnerReadServices {
  authorize(): Promise<{ok: boolean; userId?: string}>;
  costs(userId: string, days: number): Promise<unknown>;
  coverage(userId: string): Promise<unknown[]>;
}
export function createOwnerReads(userId: string, services: OwnerReadServices) {
  async function authorized<T>(read: () => Promise<T>) {
    try {
      const guard = await services.authorize();
      if (!guard.ok || guard.userId !== userId) return { status: "unavailable", error: "Owner access and two-step verification are required." };
      return await read();
    } catch {
      return { status: "unavailable", error: "The owner read failed. Do not guess or treat it as an empty report." };
    }
  }
  return {
    costs: ({days = 30}: {days?: number}) => authorized(async () => {
      const boundedDays = Number.isFinite(days) ? Math.min(365, Math.max(1, Math.floor(days))) : 30;
      return ownerCostSummary(await services.costs(userId, boundedDays));
    }),
    coverage: () => authorized(async () => {
      const rows = await services.coverage(userId);
      return { status: "ok", readAt: new Date().toISOString(), data: rows.slice(0, 25).map((r) => pick(r, ["id", "state", "place", "category", "gap", "priority", "status", "created_at"])), more: rows.length > 25,
        href: "/dashboard/admin/directory-coverage", writesAvailable: false,
        meaning: "Coverage requests are review suggestions, not verified public directory facts. Review and confirm changes on the owner screen." };
    }),
  };
}
