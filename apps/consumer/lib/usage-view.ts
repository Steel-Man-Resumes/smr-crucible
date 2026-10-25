/**
 * Settings -> Usage, pure part (TOOL-REVISIONS S5). No I/O.
 *
 * The Usage card used to show the access-code limit (getUserDailyLimit) and a
 * sum of per-tool counters, while the tools spend from the progression
 * allowance (lib/ai-operation-server.ts admission, the same numbers the
 * tailor reads in app/api/tailor-batch/route.ts allowance()). This builds the
 * card from the same inputs the tools check:
 *
 * - allowance: a new account spends Refinery AI from one daily count,
 *   base + bonus - used (progressionAllowance). Each tool may also have its
 *   own ceiling (the access-code per-tool count, or an ai_tool_policy
 *   daily_calls); those are listed only where they are lower than what the
 *   allowance has left, which is the only time they change anything.
 * - per-tool: an account from before the allowance keeps its access-code
 *   count, which applies to each tool on its own. Tools used today are listed.
 *   A bonus on such an account is one shared pool, spent only by the tools
 *   that count for progression (lib/withRateLimit.ts adds it only for those;
 *   lib/ai-operation-server.ts lets a call past the tool's count only while
 *   the account-wide bonusUsed is below the bonus). legacyToolLeft() is that
 *   rule; the tailor's allowance() uses the same function.
 * - unlimited: no daily count on this account; only tool policies can bind.
 */
import { isAiWorkflow } from './ai-operation-policy';
import { labelForEndpoint } from './ai-usage-labels';
import { countsForProgression } from './progression-policy';

export interface UsageInputs {
  /** progressionAllowance(): existing = pre-allowance account; base and bonus in actions; bonusUsed = bonus actions already spent today across tools. */
  allowance: { existing: boolean; base: number; bonus: number; used: number; bonusUsed?: number; blockedReason?: string | null };
  /** The earliest expiry among active bonus grants, if any. */
  bonusExpiresAt: string | Date | null;
  /** getUserDailyLimit(): the access-code count per tool; 0 means no count. */
  legacyLimit: number;
  /** Today's per-tool counters (ai_usage), any endpoint; non-AI keys are ignored. */
  toolUsage: Record<string, number>;
  /** Tool policies that can bind: paused, or a daily_calls ceiling, with today's runs. */
  toolPolicies: { workflow: string; disabled: boolean; daily_calls: number | null; ran: number }[];
}

export interface UsageCeiling { tool: string; label: string; left: number; paused?: boolean }
export interface UsageView {
  kind: 'allowance' | 'per-tool' | 'unlimited';
  /** Allowance actions left today (allowance kind only). */
  remaining: number | null;
  base: number | null;
  bonus: number;
  used: number;
  /** Per-tool count for the per-tool kind: the access-code count itself, without the bonus. */
  perTool: number | null;
  /** Bonus actions not yet spent today (per-tool kind: shared across the progression tools). */
  bonusLeft: number;
  bonusExpiresAt: string | null;
  /** The next midnight UTC, when the daily counts start over. */
  resetsAt: string;
  blockedReason: string | null;
  ceilings: UsageCeiling[];
}

const iso = (v: string | Date | null | undefined) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export function nextUtcMidnight(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

/**
 * What one tool has left on a per-tool (pre-allowance) account, the admission
 * rule as a number: the tool's own count, plus, for a progression tool only,
 * whatever of the shared bonus is unspent, never more than limit + bonus - count.
 */
export function legacyToolLeft(t: { limit: number; count: number; bonus: number; bonusUsed: number; progression: boolean }): number {
  const bonus = Math.max(0, t.bonus | 0);
  const share = t.progression ? Math.max(0, bonus - Math.max(0, t.bonusUsed | 0)) : 0;
  const own = Math.max(0, t.limit - (t.count | 0));
  return Math.max(0, Math.min(own + share, t.limit + (t.progression ? bonus : 0) - (t.count | 0)));
}

export function buildUsageView(input: UsageInputs, now: Date): UsageView {
  const a = input.allowance;
  const bonus = Math.max(0, a.bonus | 0);
  const bonusLeft = Math.max(0, bonus - Math.max(0, (a.bonusUsed ?? 0) | 0));
  const legacy = input.legacyLimit > 0 ? input.legacyLimit : null;
  const kind: UsageView['kind'] = !a.existing ? 'allowance' : legacy === null ? 'unlimited' : 'per-tool';
  const remaining = kind === 'allowance' ? Math.max(0, a.base + bonus - a.used) : null;

  // Every tool that has a count today or a policy, with what it has left.
  const left = new Map<string, { left: number; paused: boolean }>();
  const lower = (tool: string, n: number, paused = false) => {
    const prev = left.get(tool);
    const next = paused ? 0 : Math.max(0, n);
    left.set(tool, { left: prev ? Math.min(prev.left, next) : next, paused: paused || !!prev?.paused });
  };
  if (legacy !== null) for (const [tool, count] of Object.entries(input.toolUsage)) if (isAiWorkflow(tool)) lower(tool, legacyToolLeft({ limit: legacy, count, bonus, bonusUsed: a.bonusUsed ?? 0, progression: countsForProgression(tool) }));
  for (const p of input.toolPolicies) {
    if (!isAiWorkflow(p.workflow)) continue;
    if (p.disabled) lower(p.workflow, 0, true);
    else if (p.daily_calls != null) lower(p.workflow, p.daily_calls - (p.ran | 0));
  }
  const ceilings: UsageCeiling[] = [];
  for (const [tool, v] of left) {
    // In the allowance a tool's own ceiling matters only when it is lower than
    // what is left; per tool, every tool used today is its own count.
    if (kind === 'allowance' && !v.paused && v.left >= (remaining ?? 0)) continue;
    ceilings.push({ tool, label: labelForEndpoint(tool), left: v.left, ...(v.paused ? { paused: true } : {}) });
  }
  ceilings.sort((x, y) => x.left - y.left || x.label.localeCompare(y.label));
  // Two tools can share a label (assistant and coach are both t.ROY chat): keep the lower one.
  const seen = new Set<string>();
  const unique = ceilings.filter(c => (seen.has(c.label) ? false : (seen.add(c.label), true)));

  return {
    kind, remaining,
    base: kind === 'allowance' ? a.base : null,
    bonus, used: a.used,
    bonusLeft: kind === 'unlimited' ? 0 : bonusLeft,
    perTool: kind === 'per-tool' ? legacy : null,
    bonusExpiresAt: bonus > 0 ? iso(input.bonusExpiresAt) : null,
    resetsAt: nextUtcMidnight(now),
    blockedReason: a.blockedReason ?? null,
    ceilings: unique,
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const at = (isoTime: string, fmt?: (d: Date) => string) => {
  const d = new Date(isoTime);
  return fmt ? fmt(d) : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

/** The headline and the one plain line under it. fmt formats a time in the person's own zone. */
export function usageWords(v: UsageView, fmt?: (d: Date) => string): { headline: string; line: string; bonusLine: string | null } {
  const resets = at(v.resetsAt, fmt);
  const bonusLine = v.bonus > 0
    ? `Includes ${plural(v.bonus, 'bonus action')}${v.bonusExpiresAt ? `, good until ${at(v.bonusExpiresAt, fmt)}` : ''}.`
    : null;
  if (v.kind === 'allowance') {
    return {
      headline: `${plural(v.remaining ?? 0, 'AI action')} left today`,
      line: `Your daily allowance is ${v.base}${v.bonus ? ` plus ${v.bonus} bonus` : ''}. t.ROY chat, tailoring, interview practice, drafts and fit checks spend from it. It starts over at ${resets}.`,
      bonusLine,
    };
  }
  if (v.kind === 'per-tool') {
    // The bonus is one shared pool, not an extra count in every tool.
    return {
      headline: `${plural(v.perTool ?? 0, 'AI action')} a day in each tool`,
      line: `Each AI tool keeps its own count on this account. They start over at ${resets}.`,
      bonusLine: v.bonus > 0
        ? `Plus ${plural(v.bonus, 'bonus action')} shared across t.ROY chat, tailoring, interview practice, drafts and fit checks. ${v.bonusLeft} of them left today${v.bonusExpiresAt ? `, good until ${at(v.bonusExpiresAt, fmt)}` : ''}.`
        : null,
    };
  }
  return { headline: 'No daily AI limit on this account', line: 'A tool can still be paused or capped on its own. Any that are show below.', bonusLine: null };
}

/** What one tool has left today, from the Usage view: the allowance and the tool's own ceiling, whichever is lower. */
export function toolRemaining(v: UsageView, tool: string): { left: number | null; paused: boolean; blockedReason: string | null } {
  const own = v.ceilings.find(c => c.tool === tool);
  if (own?.paused) return { left: 0, paused: true, blockedReason: v.blockedReason };
  // Per tool, a progression tool may also spend what is left of the shared bonus.
  const pool = v.kind === 'allowance' ? v.remaining : v.kind === 'per-tool' ? (v.perTool ?? 0) + (countsForProgression(tool) ? v.bonusLeft : 0) : null;
  const parts = [pool, own?.left].filter((n): n is number => typeof n === 'number');
  return { left: parts.length ? Math.min(...parts) : null, paused: false, blockedReason: v.blockedReason };
}

/** The cost line shown before a one-action draft (the tailor's pattern: cost first, then what is left). */
export function oneActionCostLine(r: { left: number | null; paused: boolean; blockedReason: string | null } | null): { line: string; canRun: boolean } {
  const cost = 'Drafting uses 1 AI action.';
  if (!r) return { line: cost, canRun: true };
  if (r.paused) return { line: 'This tool is paused. Your saved work is still available.', canRun: false };
  if (r.blockedReason) return { line: r.blockedReason, canRun: false };
  if (r.left === null) return { line: cost, canRun: true };
  if (r.left <= 0) return { line: `${cost} You have none left today. Ask t.ROY through the progress bar for more, or come back after midnight UTC.`, canRun: false };
  return { line: `${cost} You have ${r.left} left today.`, canRun: true };
}

/** Plain words for a draft that did not come back. */
export function draftFailureWords(status: number, error?: unknown): string {
  const said = typeof error === 'string' && error.trim() && error.length < 300 ? error.trim() : '';
  if (status === 401) return 'Sign in again, then try the draft again.';
  if (status === 429 || status === 403) return said || 'Your AI allowance for today is used. Your saved work is still available.';
  if (status === 404) return 'This application could not be found. Reload the page.';
  return 'The follow-up could not be drafted. Your application is unchanged. Try again in a moment.';
}
