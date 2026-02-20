import type { EnrichmentTask, ProviderCtx, ProviderResult, EnrichmentProvider } from './types';
import { jsearchProvider } from './jsearch';
import { perplexityProvider } from './perplexity';

/** Provider priority: maps task type to ordered provider list */
const PROVIDER_PRIORITY: Record<string, string[]> = {
  'discover_jobs':            ['jsearch'],
  'discover_employers':       ['jsearch', 'perplexity'],
  'enrich_employer_contacts': ['perplexity'],
  'market_salary':            ['jsearch', 'perplexity'],
  'local_resources':          ['perplexity'],
};

const PROVIDERS: Record<string, EnrichmentProvider> = {
  jsearch: jsearchProvider,
  perplexity: perplexityProvider,
};

/**
 * Enrichment orchestrator. Selects provider by priority, handles fallback.
 * Pipeline steps call this, never providers directly.
 */
export async function enrich(
  task: EnrichmentTask,
  ctx: ProviderCtx
): Promise<ProviderResult> {
  const providerKeys = PROVIDER_PRIORITY[task.type];
  if (!providerKeys || providerKeys.length === 0) {
    throw new Error(`No providers configured for task type: ${task.type}`);
  }

  let lastError: Error | null = null;

  for (const key of providerKeys) {
    const provider = PROVIDERS[key];
    if (!provider) {
      console.warn(`Provider "${key}" not found, skipping`);
      continue;
    }

    try {
      const result = await provider.run(task, ctx);
      return result;
    } catch (err: any) {
      console.warn(`Provider "${key}" failed for ${task.type}: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(
    `All providers failed for task type "${task.type}": ${lastError?.message}`
  );
}
