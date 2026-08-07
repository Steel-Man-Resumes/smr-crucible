/**
 * Deterministic legal-accuracy guards for the Forge Career Analysis report.
 *
 * The report is shown to justice-impacted people and, at the Aug 2026 conference,
 * in front of MDOC -- legal accuracy is the highest bar. The generation prompt and
 * context-library already forbid the retired Work Opportunity Tax Credit (WOTC),
 * but a prompt can be overridden by the model. This module is the belt-and-
 * suspenders backstop (the same doctrine as stripEmDashes): a deterministic sweep
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
 * Recursively walk any value (mirrors stripEmDashes) and, in every string, drop the
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

// House-style guard (not legal, but the same deterministic-output-sweep doctrine):
// Troy's hard rule is no em dashes anywhere in the generated report. The prompts ask
// for it; this enforces it regardless of model compliance. Em dash -> "--", en dash
// -> "-" (matches the parse-route cleanup). Co-located here so both output sweeps live
// together and the adversarial suite can unit-test them.
export function stripEmDashes<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/—/g, "--").replace(/–/g, "-") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripEmDashes(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripEmDashes(v);
    return out as T;
  }
  return value;
}
