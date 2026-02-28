/**
 * Resource Search API
 *
 * Finds relevant resources based on category, barriers, and location.
 * Uses Claude to generate contextually appropriate resources.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 30;

async function handlePost(request: Request) {
  try {
    const { category, barriers, location } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ resources: [] });
    }

    const prompt = `You are a reentry resource specialist. Find 5-8 real organizations and programs for someone who needs help with: ${category}.

Context:
- Their barriers: ${barriers?.join(", ") || "not specified"}
- Location: ${location || "United States (general)"}

Return JSON:
{
  "resources": [
    {
      "name": "Organization name",
      "description": "What they offer and how to access it. 1-2 sentences.",
      "url": "website URL if known",
      "phone": "phone number if known"
    }
  ]
}

RULES:
- Prioritize REAL organizations that actually exist
- Include at least 2 national resources that anyone can access
- If location is specified, include local resources if you know them
- For legal aid: include expungement/record-sealing resources
- Keep descriptions actionable — what they do and how to contact them
- 6th grade reading level
- JSON only`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ resources: [] });
    }

    const data = await response.json();
    const text = data.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ resources: [] });

    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch (error) {
    console.error("Resource search error:", error);
    return NextResponse.json({ resources: [] });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "resources" });
