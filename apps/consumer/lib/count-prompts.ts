/**
 * "What to count" prompts for the bullet workshop (decision D2, 2026-10-07).
 *
 * t.ROY shows what could be counted for this line's work; the person gives
 * the number. No figure, range or sample count is ever offered: a prompt names
 * the thing to count and nothing else, and the figure the person types next
 * to it is their own words. Fixed here, never written by a model.
 */

interface CountRule {
  match: RegExp;
  prompts: string[];
}

const RULES: CountRule[] = [
  { match: /\b(?:truck|trailer|load|unload|dock|pallet|freight|shipment)/i, prompts: ["trucks loaded on a normal day", "pallets moved in a shift"] },
  // "On the crew with you", never "your crew": a count must not read as a crew they ran.
  { match: /\b(?:crew|team|staff|employee|coworker)/i, prompts: ["people you worked alongside on your crew"] },
  // Only when the line already says they trained, showed or taught someone.
  { match: /\b(?:train|taught|teach|show|showed|mentor)/i, prompts: ["new people you trained"] },
  { match: /\b(?:order|pick|pack|scan|inventory|stock|shelf|shelves)/i, prompts: ["orders picked in a shift", "aisles or shelves you kept stocked"] },
  { match: /\b(?:customer|table|guest|served|serve|cashier|register|plate|meal|breakfast|lunch|dinner|grill|cook|kitchen)/i, prompts: ["customers or tables on a busy shift", "plates or orders on a rush"] },
  { match: /\b(?:patient|resident|client|care|aide|nurs)/i, prompts: ["residents or patients you cared for in a shift"] },
  { match: /\b(?:part|unit|machine|cnc|weld|assembl|produc|line|batch)/i, prompts: ["parts or units you ran in a shift", "machines you ran or set up"] },
  { match: /\b(?:deliver|route|drove|drive|driver|mile|stop)/i, prompts: ["stops or deliveries on a route", "miles on a normal day"] },
  { match: /\b(?:call|phone|email|ticket|appointment|schedul)/i, prompts: ["calls or tickets in a day", "appointments you set in a week"] },
  { match: /\b(?:budget|cash|money|sale|revenue|cost|spend)/i, prompts: ["dollars you handled or tracked"] },
  { match: /\b(?:project|job site|site|install|repair|fix)/i, prompts: ["jobs or repairs in a week"] },
  // Phase 6 integration (L6): a dishwasher's line is about dishes, not customers or tables.
  { match: /\b(?:dish|dishes|dishwash\w*|pots?|pans?)\b/i, prompts: ["dishes or racks you washed in a shift"] },
];

/** Phase 6 integration (L6): the neutral prompt when the line's work is unclear. Never a figure. */
export const NEUTRAL_COUNT_PROMPT = "how many in a normal shift or week";

/**
 * The ONE thing to count for a finish-page "add a number?" prompt. It must fit
 * the job: one rule matching the line's own words (or, with none on the line,
 * exactly one matching the job title). Anything less sure gets the neutral
 * prompt, so a dishwasher is never asked about customers or tables.
 */
export function countPromptForLine(lineText: string, jobTitle = ""): string {
  const onLine = RULES.filter((r) => r.match.test(lineText));
  if (onLine.length === 1) return onLine[0].prompts[0];
  if (onLine.length === 0) {
    const onTitle = RULES.filter((r) => r.match.test(jobTitle));
    if (onTitle.length === 1) return onTitle[0].prompts[0];
  }
  return NEUTRAL_COUNT_PROMPT;
}

const FALLBACK = ["times you did this in a normal week", "people you worked with on it", "years you did this work"];

/**
 * Up to `n` things the person could count for this line, matched from the
 * line's own words and the job title. Always ends with general prompts so
 * there is something to offer for any line.
 */
export function countPromptsFor(lineText: string, jobTitle = "", n = 3): string[] {
  const text = `${lineText} ${jobTitle}`;
  const out: string[] = [];
  for (const r of RULES) {
    if (!r.match.test(text)) continue;
    for (const p of r.prompts) if (!out.includes(p)) out.push(p);
  }
  for (const p of FALLBACK) if (!out.includes(p)) out.push(p);
  return out.slice(0, Math.max(1, n));
}

/**
 * The "How many?" answer built from what the person typed beside each prompt:
 * their figure, then the thing it counts. Empty figures are left out.
 */
export function quantityFromCounts(counts: Record<string, string>): string {
  return Object.entries(counts)
    .map(([prompt, figure]) => [prompt, figure.trim()] as const)
    .filter(([, figure]) => figure)
    .map(([prompt, figure]) => `${figure} ${prompt}`)
    .join("; ");
}
