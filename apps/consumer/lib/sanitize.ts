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
  if (!input || typeof input !== "string") return "not specified";
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

/**
 * Like sanitizeForPrompt, but blank stays blank. The "not specified" label is
 * for a model reading a prompt. Anything that is stored, shown to a person,
 * sent to an employer, or tested for emptiness must use this instead: a letter
 * once risked being signed "not specified", and saved workshop answers read
 * "not specified" where the person had left a field empty.
 */
export function sanitizeOrEmpty(input: unknown, maxLength = 500, field?: string): string {
  if (typeof input !== "string" || !input.trim()) return "";
  return sanitizeForPrompt(input, maxLength, field);
}

/** List version of sanitizeOrEmpty: blank items are dropped, and an empty or
 *  missing list is "" so a fallback like `skills || "none yet"` can fire. */
export function sanitizeArrayOrEmpty(arr: unknown, maxItems = 20, maxItemLength = 200): string {
  if (!Array.isArray(arr)) return "";
  return arr
    .slice(0, maxItems)
    .map((item) => sanitizeOrEmpty(item, maxItemLength))
    .filter(Boolean)
    .join(", ");
}

export function sanitizeArray(arr: string[] | undefined | null, maxItems = 20, maxItemLength = 200): string {
  if (!arr || !Array.isArray(arr)) return "not specified";
  return arr
    .slice(0, maxItems)
    .map(item => sanitizeForPrompt(item, maxItemLength))
    .join(", ");
}
