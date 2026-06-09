/**
 * Web search tool -- backed by Perplexity "sonar" (online + cited).
 *
 * Lets the coach verify a CURRENT fact (a law, a fair-chance employer, a
 * program's status) instead of stating possibly-stale prose. This is the
 * highest-harm zone (legal accuracy), so the tool returns sources and the
 * description tells the model to cite them and not to state law as settled
 * without checking.
 *
 * Server-only: reads PERPLEXITY_API_KEY, used inside /api/coach via the AI SDK.
 */

import { tool, jsonSchema } from "ai";

const PPLX_URL = "https://api.perplexity.ai/chat/completions";

export interface WebSearchResult {
  answer: string;
  sources: { title: string; url: string }[];
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { answer: "Web search is unavailable right now.", sources: [] };
  }

  try {
    const res = await fetch(PPLX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "Answer concisely and factually. Lead with the jurisdiction and date when relevant. If the answer is uncertain or varies by place, say so explicitly.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      console.error("[web-search] perplexity error", res.status);
      return {
        answer: "Web search failed -- do not state the fact as confirmed.",
        sources: [],
      };
    }

    const data = await res.json();
    const answer: string = data.choices?.[0]?.message?.content ?? "";

    const sources: { title: string; url: string }[] = [];
    const results = Array.isArray(data.search_results) ? data.search_results : [];
    for (const r of results.slice(0, 4)) {
      if (r?.url) sources.push({ title: r.title || r.url, url: r.url });
    }
    if (sources.length === 0 && Array.isArray(data.citations)) {
      for (const url of data.citations.slice(0, 4)) {
        if (typeof url === "string") sources.push({ title: url, url });
      }
    }

    return { answer, sources };
  } catch (err) {
    console.error("[web-search] failed", err instanceof Error ? err.message : err);
    return { answer: "Web search failed.", sources: [] };
  }
}

/** AI SDK tool wrapper -- the coach calls this when a current fact must be verified. */
export const webSearchTool = tool({
  description:
    "Check a CURRENT fact that may have changed since training: a law (ban-the-box, expungement, WOTC status, licensing), a specific fair-chance employer, or a program's current status. Returns a sourced answer. Use it whenever the user's question depends on current law or current employer/program facts. Cite what you find. Do NOT state law as settled without checking.",
  parameters: jsonSchema<{ query: string }>({
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A focused search query. Include the jurisdiction (state/city) and the year when the answer could vary by place or time.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  execute: async ({ query }) => {
    const r = await webSearch(query);
    if (!r.sources.length) return r.answer;
    return (
      r.answer +
      "\n\nSources:\n" +
      r.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")
    );
  },
});
