/**
 * Shared AI call helper -- currently wired to OpenAI (gpt-4o).
 * Anthropic keys stay in Vercel; swap back by changing this file.
 */

export const AI_PROVIDER = "openai";
export const AI_MODEL = "gpt-4o";

export async function callAI(
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2048
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const allMessages: Array<{ role: string; content: string }> = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      messages: allMessages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}
