/**
 * Sanitize user input before interpolating into AI prompts.
 * Prevents prompt injection by escaping control sequences.
 */
export function sanitizeForPrompt(input: string | undefined | null, maxLength = 500): string {
  if (!input) return "not specified";
  return input
    .replace(/\n/g, " ")           // Remove newlines (primary injection vector)
    .replace(/\r/g, " ")           // Remove carriage returns
    .replace(/\t/g, " ")           // Remove tabs
    .replace(/\s+/g, " ")          // Collapse whitespace
    .trim()
    .slice(0, maxLength);
}

export function sanitizeArray(arr: string[] | undefined | null, maxItems = 20, maxItemLength = 200): string {
  if (!arr || !Array.isArray(arr)) return "not specified";
  return arr
    .slice(0, maxItems)
    .map(item => sanitizeForPrompt(item, maxItemLength))
    .join(", ");
}
