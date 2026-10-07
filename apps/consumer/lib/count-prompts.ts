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
  { match: /\b(?:crew|team|supervis|lead|train|mentor|staff|new hire|employee)/i, prompts: ["people on your crew", "new people you trained"] },
  { match: /\b(?:order|pick|pack|scan|inventory|stock|shelf|shelves)/i, prompts: ["orders picked in a shift", "aisles or shelves you kept stocked"] },
  { match: /\b(?:customer|table|guest|served|serve|cashier|register|plate|meal|breakfast|lunch|dinner|grill|cook|kitchen)/i, prompts: ["customers or tables on a busy shift", "plates or orders on a rush"] },
  { match: /\b(?:patient|resident|client|care|aide|nurs)/i, prompts: ["residents or patients you cared for in a shift"] },
  { match: /\b(?:part|unit|machine|cnc|weld|assembl|produc|line|batch)/i, prompts: ["parts or units you ran in a shift", "machines you ran or set up"] },
  { match: /\b(?:deliver|route|drove|drive|driver|mile|stop)/i, prompts: ["stops or deliveries on a route", "miles on a normal day"] },
  { match: /\b(?:call|phone|email|ticket|appointment|schedul)/i, prompts: ["calls or tickets in a day", "appointments you set in a week"] },
  { match: /\b(?:budget|cash|money|sale|revenue|cost|spend)/i, prompts: ["dollars you handled or tracked"] },
  { match: /\b(?:project|job site|site|install|repair|fix)/i, prompts: ["jobs or repairs in a week"] },
];

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
