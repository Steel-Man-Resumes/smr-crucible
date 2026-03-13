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
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { record, timing, targetJob, forgeContext } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    // Build candidate profile from Forge data
    let candidateBlock = "";
    if (targetJob || forgeContext) {
      const parts: string[] = [];
      if (targetJob) parts.push(`Target role: ${sanitizeForPrompt(targetJob)}`);
      if (forgeContext?.headline) parts.push(`Professional headline: ${sanitizeForPrompt(forgeContext.headline)}`);
      if (forgeContext?.strengths?.length) {
        parts.push(`Key strengths to pivot to after disclosure: ${forgeContext.strengths.map((s: any) => `${sanitizeForPrompt(s.title)}: ${sanitizeForPrompt(s.evidence)}`).join("; ")}`);
      }
      if (forgeContext?.skills?.length) {
        parts.push(`Top skills: ${sanitizeArray(forgeContext.skills.map((s: any) => s.name))}`);
      }
      candidateBlock = `\n\nCANDIDATE PROFILE:\n${parts.join("\n")}`;
    }

    const prompt = `You are a reentry career specialist helping someone plan how to disclose their criminal record to employers.

THEIR SITUATION:
- Charge type: ${sanitizeForPrompt(record.type)}
- Number of charges: ${sanitizeForPrompt(record.charge_count)}
- Most recent: ${sanitizeForPrompt(record.most_recent)}
- Probation/parole: ${sanitizeForPrompt(record.supervision)}
- State: ${sanitizeForPrompt(record.state)}
- Preferred timing: ${sanitizeForPrompt(timing, 200) || "not sure"}${candidateBlock}

GENERATE a disclosure plan as JSON:
{
  "timing_advice": "When they should disclose and why, specific to their situation. Consider ban-the-box laws in their state if known.",
  "legal_context": "Relevant laws and rights. Ban-the-box status, expungement eligibility, what employers can/cannot ask.",
  "script": "A natural, conversational script they can use. Under 30 seconds spoken. Acknowledges the past, pivots to growth and value. If candidate strengths are provided, reference them specifically in the pivot. Must sound human, not rehearsed.",
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

    const result = JSON.parse(jsonMatch[0]);

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "disclosure-guide",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: JSON.stringify({ record, timing }).slice(0, 500),
        explanation: "Generated disclosure plan based on criminal record type, recency, and jurisdiction",
        outputSummary: {
          type: "disclosure_plan",
          has_script: !!result.script,
          tips_count: result.tips?.length ?? 0,
        },
      });
    } catch (err) {
      console.error("Decision log failed (disclosure):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Disclosure guide error:", error);
    return NextResponse.json(
      { error: "Could not generate plan" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "disclosure", requiredTier: "client" });
