/**
 * Sanitize user input before interpolating into AI prompts.
 * NORMALIZES text before it is placed in a prompt: collapses whitespace and
 * caps length. It does NOT prevent prompt injection -- an instruction needs no
 * newline to influence a model -- and nothing should rely on it as a security
 * boundary. Authority comes from what the server lets a tool do, not from this.
 */
export function sanitizeForPrompt(
  input: string | undefined | null,
  maxLength = 500,
  // Optional field label. When supplied AND the (collapsed) input is longer than
  // maxLength, a console.warn records the truncation so a silent data loss of
  // real source material is always observable (Phase 2.4).
  field?: string
): string {
  if (!input) return "not specified";
  const collapsed = input
    .replace(/\n/g, " ")           // Collapse newlines (tidiness, not a defense)
    .replace(/\r/g, " ")           // Remove carriage returns
    .replace(/\t/g, " ")           // Remove tabs
    .replace(/\s+/g, " ")          // Collapse whitespace
    .trim();
  if (field && collapsed.length > maxLength) {
    console.warn(`[sanitizeForPrompt] truncated ${field}: ${collapsed.length} -> ${maxLength} chars (data loss)`);
  }
  return collapsed.slice(0, maxLength);
}

export function sanitizeArray(arr: string[] | undefined | null, maxItems = 20, maxItemLength = 200): string {
  if (!arr || !Array.isArray(arr)) return "not specified";
  return arr
    .slice(0, maxItems)
    .map(item => sanitizeForPrompt(item, maxItemLength))
    .join(", ");
}
