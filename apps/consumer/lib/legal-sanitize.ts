/**
 * Deterministic legal-accuracy guards for the Forge Career Analysis report.
 *
 * The report is shown to justice-impacted people and, at the Aug 2026 conference,
 * in front of MDOC -- legal accuracy is the highest bar. The generation prompt and
 * context-library already forbid the retired Work Opportunity Tax Credit (WOTC),
 * but a prompt can be overridden by the model. This module is the belt-and-
 * suspenders backstop (the same doctrine as plainPunctuation): a deterministic sweep
 * over the whole output object that removes any WOTC / Form 8850 reference before
 * it can ship. Kept in its own module so the adversarial suite (P1.9) can unit-test
 * it directly.
 *
 * WOTC expired for hires beginning after 2025-12-31 and Form 8850 is retired; the
 * current no-cost employer incentive is the Federal Bonding Program.
 */

// Catches: "WOTC", "Work Opportunity Tax Credit", "Work Opportunity Credit",
// "Form 8850", "IRS 8850", "8850 form". Deliberately does NOT match a bare "8850"
// (avoids nuking a stray number); the form is always referenced with "form"/"irs".
export const WOTC_RE =
  /\b(?:wotc|work[\s-]*opportunity[\s-]*(?:tax[\s-]*)?credit|(?:form|irs)\s*8850|8850\s*form)\b/i;

/**
 * Recursively walk any value (mirrors plainPunctuation) and, in every string, drop the
 * sentence(s) that reference the retired WOTC / Form 8850. If a reference survives
 * sentence removal (no boundary to split on), the whole string is blanked rather
 * than leak it -- a blank legal note is safe; a WOTC claim in front of MDOC is not.
 */
export function stripEmployerTaxCredit<T>(value: T): T {
  if (typeof value === "string") {
    if (!WOTC_RE.test(value)) return value;
    const cleaned = value
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !WOTC_RE.test(sentence))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return (WOTC_RE.test(cleaned) ? "" : cleaned) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripEmployerTaxCredit(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripEmployerTaxCredit(v);
    return out as T;
  }
  return value;
}

// House-style guard (not legal, but the same deterministic-output-sweep doctrine).
// Generated documents carry no dash used as punctuation: no em dash and no "--"
// stand-in. The prompts ask the model to write sentences that need neither; this
// enforces it regardless of model compliance. A dash becomes a period when a full
// clause is followed by a capitalized one, otherwise a comma. En dash -> "-" so
// date ranges ("2019 - Present") stay readable. Text a person typed or uploaded is
// NOT passed through this: it is theirs and stays as they wrote it.
// Co-located here so both output sweeps live together and the adversarial suite
// can unit-test them.
const DASH_RE = /[ \t]*(?:\u2014|(?<!-)--(?!-))[ \t]*/g;

export function plainPunctuationText(input: string): { text: string; swaps: number } {
  let swaps = 0;
  // A spaced en dash is punctuation, same as an em dash; an unspaced one is a range.
  let text = input.replace(/[ \t]\u2013[ \t]/g, " \u2014 ").replace(/\u2013/g, "-");
  // A line that STARTS with a dash is a bullet, not punctuation.
  text = text.replace(/^([ \t]*)(?:\u2014|--)[ \t]+/gm, "$1- ");
  text = text.replace(DASH_RE, (match, offset: number, whole: string) => {
    swaps++;
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + match.length);
    const prevChar = before.slice(-1);
    const nextChar = after.charAt(0);
    if (!nextChar || nextChar === "\n") return "";
    if (!prevChar || prevChar === "\n") return "";
    if (/\d/.test(prevChar) && /\d/.test(nextChar)) return "-";
    if (/[,.;:!?]/.test(prevChar)) return " ";
    const clause = before.slice(Math.max(before.lastIndexOf("\n"), before.search(/[.!?][^.!?]*$/)) + 1);
    const fullClause = clause.trim().split(/\s+/).length >= 4;
    return fullClause && /[A-Z]/.test(nextChar) ? ". " : ", ";
  });
  return { text, swaps };
}

export function plainPunctuation<T>(value: T, onSwap?: (count: number) => void): T {
  let total = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = plainPunctuationText(v);
      total += r.swaps;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const result = walk(value) as T;
  if (total > 0 && onSwap) onSwap(total);
  return result;
}

// Counts only, never content: how often a prompt failed to keep dashes out.
export function logDashSwaps(endpoint: string) {
  return (count: number) => console.warn(`[plain-punctuation] ${endpoint}: swapped ${count} dash(es) in model output`);
}
