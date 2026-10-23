export interface CoverageReceipt { requestId: string; status: "pending" }
export function readCoverageReceipt(value: unknown): CoverageReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.status === "pending" && typeof v.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.requestId)
    ? { requestId: v.requestId, status: "pending" } : null;
}
