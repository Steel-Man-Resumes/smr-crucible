/**
 * Resume Generation Helper API
 *
 * Provides AI suggestions for the Application Tailor.
 * Does NOT auto-generate — gives starting points the user edits.
 * Each suggestion logged to decision_log.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { buildFullContext } from "@/lib/context-library";
import { isMockEnabled, MOCK_RESUME } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  if (isMockEnabled()) {
    return NextResponse.json({ content: MOCK_RESUME, scaffoldLevel: 0.5 });
  }

  try {
    const body = await request.json();
    const { targetJob, targetCompany, jobListingUrl, existingBullets, skills, forgeNarrative, forgeStrengths, action } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    // Build context from Forge data if available
    const sanitizedTargetJob = sanitizeForPrompt(targetJob);
    const sanitizedTargetCompany = sanitizeForPrompt(targetCompany);
    const sanitizedSkills = sanitizeArray(skills);
    const sanitizedBullets = sanitizeArray(existingBullets, 20, 500);

    const forgeContext = [];
    if (forgeNarrative) forgeContext.push(`About this person: ${sanitizeForPrompt(forgeNarrative, 1000)}`);
    if (forgeStrengths?.length) forgeContext.push(`Key strengths: ${sanitizeArray(forgeStrengths)}`);
    if (jobListingUrl) forgeContext.push(`Job listing: ${sanitizeForPrompt(jobListingUrl, 2000)}`);
    const forgeBlock = forgeContext.length > 0 ? `\n\n${forgeContext.join("\n")}` : "";

    // Research context for resume suggestions
    const resumeResearch = buildFullContext("resume", undefined, { targetJob, targetCompany });

    let prompt = "";

    if (action === "suggest_summary") {
      prompt = `${resumeResearch}

Write a 2-3 sentence professional summary for someone applying for a ${sanitizedTargetJob} position${targetCompany ? ` at ${sanitizedTargetCompany}` : ""}.

Their skills include: ${sanitizedSkills}.
${existingBullets?.length ? `They've described their experience as: ${sanitizedBullets}` : ""}${forgeBlock}

RULES:
- Write at a 6th grade reading level
- Be specific, not generic
- No buzzwords like "results-driven" or "detail-oriented"
- Keep it honest and grounded
- NEVER mention incarceration, criminal records, justice involvement, or any disqualifying information
- 2-3 sentences max`;
    } else if (action === "suggest_bullet") {
      prompt = `Suggest one experience bullet point for a ${sanitizedTargetJob} resume.
Their skills: ${sanitizedSkills || "general"}.
Existing bullets: ${sanitizedBullets || "none yet"}.${forgeBlock}

Write ONE bullet starting with an action verb. Include a number or result if possible.
No buzzwords. Keep it honest. One sentence only.
NEVER mention incarceration, criminal records, or any disqualifying information.`;
    } else {
      return NextResponse.json(
        { error: "Unknown action" },
        { status: 400 }
      );
    }

    const suggestion = (await callAI("", [{ role: "user", content: prompt }], 300)).trim();

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "resume-generate",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: JSON.stringify({ targetJob, action, skills }).slice(0, 500),
        explanation: `Generated resume ${action === "suggest_summary" ? "summary" : "bullet point"} for ${targetJob}${targetCompany ? ` at ${targetCompany}` : ""}.`,
        outputSummary: {
          type: "resume_suggestion",
          action,
          suggestion_length: suggestion.length,
        },
      });
    } catch (err) {
      console.error("Decision log failed (resume-generate):", err);
    }

    return NextResponse.json({ suggestion });
  } catch (error: any) {
    console.error("Resume generate error:", error);
    return NextResponse.json(
      { error: "Could not generate suggestion" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "resume", requiredTier: "client" });
