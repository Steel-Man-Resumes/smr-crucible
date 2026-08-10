/**
 * Sanitize user input before interpolating into AI prompts.
 * Prevents prompt injection by escaping control sequences.
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
    .replace(/\n/g, " ")           // Remove newlines (primary injection vector)
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
