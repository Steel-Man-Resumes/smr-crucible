/**
 * Shared data-loss guardrails (Phase 2.4, 2026-08-10).
 *
 * The generation and verification paths used to silently cut real user material
 * to small caps (4000/6000/8000 chars) before it ever reached the model or the
 * truth gate -- so an ordinary long resume was quietly truncated and the tail
 * was never generated from, or worse, never fact-checked. These caps are raised
 * to values that fit ordinary long resumes, and every truncation is now
 * OBSERVABLE via sliceWithWarn / the field-aware sanitize path -- never silent.
 *
 * These are NOT the one-page word/skill-count prompt caps (those wait for the
 * page-fit engine). These bound how much SOURCE material we admit, never how
 * long the OUTPUT may be.
 */

/** Max source-resume characters admitted into a prompt or grounding source. */
export const RESUME_SOURCE_MAX = 20000;
/** Max job-description characters admitted into a prompt. */
export const JD_MAX = 12000;
/** Max characters the grounding verifier audits per source/output window. */
export const VERIFY_MAX = 20000;

/**
 * Slice a string to `max`, but LOUDLY: if the input is longer than the cap we
 * log a console.warn naming the field and the original length, so a truncation
 * that drops real content is always observable in the logs (never silent).
 * Returns "" for non-strings so callers can use it defensively.
 */
export function sliceWithWarn(text: unknown, max: number, field: string): string {
  if (typeof text !== "string") return "";
  if (text.length > max) {
    console.warn(`[limits] truncated ${field}: ${text.length} -> ${max} chars (data loss)`);
    return text.slice(0, max);
  }
  return text;
}
