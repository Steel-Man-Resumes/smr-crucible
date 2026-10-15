/** Provider counts and explicit pricing confidence. No unknown model is priced
 * by guessing. Rates checked 2026-10-15 against the first-party pricing pages:
 * https://platform.claude.com/docs/en/about-claude/pricing
 * https://developers.openai.com/api/docs/pricing
 */
import { currentAiOperation, trackUsageWrite } from './ai-operation-context';
interface ModelPrice { input: number; output: number; cacheRead: number; }
const PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: .3 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: .2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: .1 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: .1 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: .5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: .5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: .5 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
  'gpt-4o-mini': { input: .15, output: .6, cacheRead: .075 },
};
function priceFor(model: string): ModelPrice | undefined {
  if (PRICES[model]) return PRICES[model];
  // Only a documented date snapshot may inherit an alias price. A new model
  // whose name merely begins with an old one must remain visibly unpriced.
  const key = Object.keys(PRICES).sort((a,b) => b.length-a.length)
    .find(k => model.startsWith(k + '-') && /^\d{4}-?\d{2}-?\d{2}$/.test(model.slice(k.length+1)));
  return key ? PRICES[key] : undefined;
}
export interface TokenUsage {
  /** Uncached input for Anthropic; callers subtract OpenAI cached tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  audioSeconds?: number;
}
export interface AiCallMeta {
  userId?: string | null;
  endpoint?: string;
  anthropicOnly?: boolean;
  operationId?: string;
  eventKey?: string;
  outcome?: 'succeeded' | 'failed' | 'unknown';
  /** Provider gave no usage (including transport failures). Never imply free. */
  usageMissing?: boolean;
}
export interface CostMeasurement {
  costUsd: number | null;
  status: 'priced' | 'estimated' | 'unpriced';
  basis: string;
}
const count = (v: number | undefined) => Number.isFinite(v) && v! >= 0 ? v! : 0;
const round = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
export function measureCost(model: string, usage: TokenUsage): CostMeasurement {
  if ([usage.inputTokens,usage.outputTokens,usage.cacheCreationInputTokens ?? 0,usage.cacheReadInputTokens ?? 0]
    .some(value=>!Number.isFinite(value) || value < 0)) return {costUsd:null,status:'unpriced',basis:'provider token counts unavailable'};
  if (count(usage.audioSeconds) > 0) {
    // Planning estimate only: half the elapsed session as input speech and half
    // as output. Silence, repeated context and text can change the real bill.
    // Rates: gpt-realtime-2 model page, 2026-10-15, audio $32/$64 per MTok.
    // Token rates: OpenAI voice-latency-cost, input 10/s, output 20/s.
    const override = Number(process.env.VOICE_ESTIMATE_USD_PER_MINUTE);
    const rate = Number.isFinite(override) && override > 0 ? override
      : model === 'gpt-realtime-2' ? (300 * 32 + 600 * 64) / 1_000_000 : null;
    if (rate !== null) return {
      costUsd: round(count(usage.audioSeconds) / 60 * rate), status: 'estimated',
      basis: override > 0 ? 'owner-configured elapsed-session estimate' : 'elapsed session; 50/50 speech estimate; excludes replayed context/text; rates 2026-10-15',
    };
    return { costUsd: null, status: 'unpriced', basis: 'elapsed audio only; model price unavailable' };
  }
  const p = priceFor(model);
  if (!p) return { costUsd: null, status: 'unpriced', basis: 'model price not verified' };
  return { costUsd: round((count(usage.inputTokens) * p.input + count(usage.outputTokens) * p.output
    + count(usage.cacheCreationInputTokens) * p.input * 1.25 + count(usage.cacheReadInputTokens) * p.cacheRead) / 1_000_000),
    status: 'priced', basis: 'provider token counts; standard global rates checked 2026-10-15' };
}
/** Budget callers must refuse an unpriceable estimate, never convert null to 0. */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  const value = measureCost(model, usage).costUsd;
  if (value === null) throw new Error('AI_PRICE_UNAVAILABLE');
  return value;
}
function writeUsage(provider: string, model: string, usage: TokenUsage, price: CostMeasurement, meta?: AiCallMeta): Promise<void> {
  const context = currentAiOperation();
  const merged = { ...context, ...meta };
  const write = (async () => {
    try {
      const { query } = await import('@crucible/core');
      await query(`INSERT INTO ai_token_usage
        (user_id,endpoint,provider,model,input_tokens,output_tokens,cache_creation_input_tokens,
         cache_read_input_tokens,cost_usd,audio_seconds,cost_status,cost_basis,operation_id,outcome,event_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`, [
        merged.userId || null, merged.endpoint || 'unknown', provider, model,
        count(usage.inputTokens),count(usage.outputTokens),count(usage.cacheCreationInputTokens),count(usage.cacheReadInputTokens),
        price.costUsd,count(usage.audioSeconds),price.status,price.basis,merged.operationId || null,
        merged.outcome || 'succeeded',merged.eventKey || null,
      ]);
    } catch {
      // Fixed diagnostic only: a DB exception can carry row content.
      if (context) context.accountingIncomplete = true;
      console.error('AI_USAGE_WRITE_FAILED');
    }
  })();
  trackUsageWrite(write);
  return write;
}
/** Await at request boundaries; legacy callers remain tracked by their workflow. */
export function recordTokenUsage(provider: string, model: string, usage: TokenUsage, meta?: AiCallMeta): Promise<void> {
  return writeUsage(provider,model,usage,meta?.usageMissing
    ? {costUsd:null,status:'unpriced',basis:'provider did not report usage'} : measureCost(model,usage),meta);
}
export function recordFlatUsage(provider: string, model: string, costUsd: number, meta?: AiCallMeta): Promise<void> {
  return writeUsage(provider,model,{inputTokens:0,outputTokens:0},Number.isFinite(costUsd) && costUsd >= 0
    ? {costUsd,status:'estimated',basis:'per-operation estimate'}
    : {costUsd:null,status:'unpriced',basis:'operation price unavailable'},meta);
}
