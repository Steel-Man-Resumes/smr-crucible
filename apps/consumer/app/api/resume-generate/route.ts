/**
 * Resume Generation Helper API
 *
 * Provides AI suggestions for the Resume Builder.
 * Does NOT auto-generate — gives starting points the user edits.
 * Each suggestion logged to decision_log.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 30;

async function handlePost(request: Request) {
  try {
    const body = await request.json();
    const { targetJob, targetCompany, existingBullets, skills, action } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    let prompt = "";

    if (action === "suggest_summary") {
      prompt = `Write a 2-3 sentence professional summary for someone applying for a ${targetJob} position${targetCompany ? ` at ${targetCompany}` : ""}.

Their skills include: ${skills?.join(", ") || "not specified"}.
${existingBullets?.length ? `They've described their experience as:\n${existingBullets.join("\n")}` : ""}

RULES:
- Write at a 6th grade reading level
- Be specific, not generic
- No buzzwords like "results-driven" or "detail-oriented"
- Keep it honest and grounded
- 2-3 sentences max`;
    } else if (action === "suggest_bullet") {
      prompt = `Suggest one experience bullet point for a ${targetJob} resume.
Their skills: ${skills?.join(", ") || "general"}.
Existing bullets: ${existingBullets?.join("; ") || "none yet"}.

Write ONE bullet starting with an action verb. Include a number or result if possible.
No buzzwords. Keep it honest. One sentence only.`;
    } else {
      return NextResponse.json(
        { error: "Unknown action" },
        { status: 400 }
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const suggestion = data.content[0]?.text?.trim() || "";

    return NextResponse.json({ suggestion });
  } catch (error: any) {
    console.error("Resume generate error:", error);
    return NextResponse.json(
      { error: "Could not generate suggestion" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "resume" });
