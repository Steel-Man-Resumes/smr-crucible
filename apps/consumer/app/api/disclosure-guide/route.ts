/**
 * Disclosure Guide API
 *
 * Generates a personalized disclosure plan based on:
 * - Type of conviction
 * - Recency
 * - Jurisdiction (ban-the-box laws)
 * - User's preferred timing
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 30;

async function handlePost(request: Request) {
  try {
    const { record, timing } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    const prompt = `You are a reentry career specialist helping someone plan how to disclose their criminal record to employers.

THEIR SITUATION:
- Charge type: ${record.type || "not specified"}
- Number of charges: ${record.charge_count || "not specified"}
- Most recent: ${record.most_recent || "not specified"}
- Probation/parole: ${record.supervision || "not specified"}
- State: ${record.state || "not specified"}
- Preferred timing: ${timing || "not sure"}

GENERATE a disclosure plan as JSON:
{
  "timing_advice": "When they should disclose and why, specific to their situation. Consider ban-the-box laws in their state if known.",
  "legal_context": "Relevant laws and rights. Ban-the-box status, expungement eligibility, what employers can/cannot ask.",
  "script": "A natural, conversational script they can use. Under 30 seconds spoken. Acknowledges the past, pivots to growth and value. Must sound human, not rehearsed.",
  "tips": [
    "tip 1 — specific, actionable",
    "tip 2",
    "tip 3",
    "tip 4"
  ]
}

RULES:
- Be honest but empowering
- The script should acknowledge the record briefly, then pivot to what they've done since and what they bring
- For felonies 10+ years old, note that many employers care less about old records
- Never minimize what happened, but always connect to growth
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
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch (error: any) {
    console.error("Disclosure guide error:", error);
    return NextResponse.json(
      { error: "Could not generate plan" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "disclosure" });
