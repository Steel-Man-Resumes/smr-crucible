/** Only expensive work is configurable. Downloads, safety, help and deletion
 * never enter this registry. Existing quota and premium checks still apply. */
export const AI_WORKFLOWS = [
  'assistant','coach','analyze','story-check','forge-package-story','generate-docs','forge-resume-assist',
  'forge-suggest-fix','forge-recheck','second-check','resume','resume-full',
  'interview','interview-voice-token',
  'quick-apply','follow-up','intake-followups','disclosure','disclosure-takeaways',
  'apply-email','parse','rush-resume','resume-fine-tune','next-step-why','fit-check','disclosure-strengths',
] as const;
export type AiWorkflow = typeof AI_WORKFLOWS[number];
export function isAiWorkflow(value: string): value is AiWorkflow {
  return (AI_WORKFLOWS as readonly string[]).includes(value);
}
export interface ToolPolicy {
  workflow: AiWorkflow;
  disabled: boolean;
  daily_calls: number | null;
  daily_usd: number | null;
  reserve_usd: number | null;
  premium_tool: 'resources' | 'interview_coaching' | 'one_click_apply' | null;
}
export function parseToolPolicy(raw: unknown): ToolPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.workflow !== 'string' || !isAiWorkflow(p.workflow) || typeof p.disabled !== 'boolean') return null;
  for (const key of ['daily_calls','daily_usd','reserve_usd']) {
    if (p[key] !== null && (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || (p[key] as number) < 0)) return null;
  }
  if (p.daily_calls !== null && !Number.isInteger(p.daily_calls)) return null;
  if (p.reserve_usd !== null && (p.reserve_usd as number) <= 0) return null;
  if (p.daily_usd !== null && p.reserve_usd === null) return null;
  if (p.premium_tool !== null && !['resources','interview_coaching','one_click_apply'].includes(String(p.premium_tool))) return null;
  return p as unknown as ToolPolicy;
}
