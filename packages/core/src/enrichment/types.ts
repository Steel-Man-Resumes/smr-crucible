/** Enrichment task types — what callers request */
export type EnrichmentTask =
  | { type: 'discover_jobs'; params: { query: string; location: string; pages: number } }
  | { type: 'discover_employers'; params: { industry: string; location: string; second_chance: boolean } }
  | { type: 'enrich_employer_contacts'; params: { employers: Array<{ name: string; location: string }> } }
  | { type: 'market_salary'; params: { role: string; location: string } }
  | { type: 'local_resources'; params: { location: string; barrier_types: string[] } };

/** Normalized result from any provider */
export interface ProviderResult {
  data: unknown;
  provider: string;
  latency_ms: number;
  raw_response?: unknown;
}

/** Context passed to providers for logging/auth */
export interface ProviderCtx {
  runId: string;
  orgId: string;
  projectId: string;
  correlationId: string;
}

/** Provider interface — all enrichment sources implement this */
export interface EnrichmentProvider {
  key: string;
  capabilities: string[];
  run(task: EnrichmentTask, ctx: ProviderCtx): Promise<ProviderResult>;
}
