/**
 * Robust JSON parser for AI responses
 * Handles malformed JSON from Claude, GPT, and other LLMs
 * Ported from smr-forge lib/jsonParser.ts
 */

/**
 * Find a brace-matched JSON block starting from the first { or [
 * Returns the extracted substring, or null if no valid block found
 */
function extractBraceMatched(text: string): string | null {
  let start = -1;
  let closeChar = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      closeChar = text[i] === '{' ? '}' : ']';
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if (depth === 0) {
      return text.substring(start, i + 1);
    }
  }
  return null;
}

export function extractAndParseJSON(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid input: text must be a non-empty string');
  }

  let jsonText = text.trim();

  // Strip markdown code fences
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  // Extract JSON block using brace-matching
  const extracted = extractBraceMatched(jsonText);
  if (extracted) {
    jsonText = extracted;
  }

  // Clean smart quotes
  jsonText = jsonText
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2032\u2035]/g, "'")
    .replace(/[\u2033\u2036]/g, '"');

  // Remove trailing commas before } or ]
  jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');

  // Remove JS-style comments
  jsonText = jsonText.replace(/\/\/.*$/gm, '');
  jsonText = jsonText.replace(/\/\*[\s\S]*?\*\//g, '');

  // Normalize line breaks
  jsonText = jsonText
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Attempt to parse
  try {
    return JSON.parse(jsonText);
  } catch (error: any) {
    // Try aggressive whitespace cleanup as fallback
    try {
      const minified = jsonText
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return JSON.parse(minified);
    } catch (secondError: any) {
      const preview = jsonText.substring(0, 200);
      throw new Error(
        `Failed to parse JSON. Original error: ${error.message}. ` +
        `Text preview: ${preview}...`
      );
    }
  }
}

export function safeParseJSON<T = any>(text: string, defaultValue: T): T {
  try {
    return extractAndParseJSON(text) as T;
  } catch {
    return defaultValue;
  }
}

export function extractAndParseJSONArray(text: string): any[] {
  const result = extractAndParseJSON(text);
  if (!Array.isArray(result)) {
    throw new Error('Expected JSON array, got: ' + typeof result);
  }
  return result;
}

export function extractAndParseJSONObject(text: string): Record<string, any> {
  const result = extractAndParseJSON(text);
  if (typeof result !== 'object' || Array.isArray(result) || result === null) {
    throw new Error('Expected JSON object, got: ' + typeof result);
  }
  return result;
}
