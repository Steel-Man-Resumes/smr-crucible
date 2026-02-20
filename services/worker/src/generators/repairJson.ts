/**
 * Shared JSON repair helper for all generators.
 * Wraps parseWithRepair from core with a Claude repair callback.
 */
import { parseWithRepair } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';

const REPAIR_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Parse JSON from AI output with automatic repair on failure.
 * First tries extractAndParseJSON, then asks Claude to fix broken JSON.
 */
export async function parseAIJson(text: string): Promise<any> {
  return parseWithRepair(text, async (broken: string, error: string) => {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: REPAIR_MODEL,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `The following text was supposed to be valid JSON but has a parse error: "${error}"

Fix the JSON and return ONLY the corrected JSON, nothing else. Common issues: unescaped quotes, trailing commas, control characters in strings, unclosed brackets.

---
${broken.substring(0, 12000)}
---`,
      }],
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  });
}
