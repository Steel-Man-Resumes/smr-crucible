/**
 * Rush Resume API Route
 *
 * Takes a rough resume + target job, returns a rewritten resume
 * with professional summary, strong bullets, and relevant skills.
 *
 * Crucible rules: only uses facts from the original resume. Never fabricates.
 * IP-rate-limited (Forge flow, no auth required).
 * Decision-logged for JBS compliance.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 60;

interface RushInput {
  resumeText: string;
  targetJob: string;
  targetCompany?: string;
  jobDescription?: string;
}

const SYSTEM_PROMPT = `You are a professional resume rewriter for Steel Man Resumes.

You take a rough/weak resume and rewrite it for a specific target job.

RULES:
- ONLY use facts from the original resume. Never fabricate experience, employers, dates, or skills.
- Rewrite bullets with strong action verbs and quantify where the original implies scale.
- Write a new professional summary targeted to the specific job.
- Extract and organize skills relevant to the target role.
- 6th grade reading level. Short sentences. No buzzwords ("results-driven", "detail-oriented").
- If the resume is thin, work with what's there. An honest 3-bullet resume beats a fabricated 10-bullet one.
- NEVER mention incarceration, prison, jail, correctional facilities, parole, probation, criminal records, convictions, justice involvement, re-entry, or any disqualifying information. Not even obliquely. Not even with growth framing. This is a paper document and disclosure should ONLY happen in person during interviews.
- For employment gaps, simply omit or skip that period. Do NOT explain gaps. Use a functional/skills-based format if needed.
- If the original resume mentions prison, jail, incarceration, parole officers, correctional programs, etc., IGNORE those details entirely. Extract only the skills, education, and certifications gained — never mention WHERE they were earned if the location was a correctional facility.
- Parole officer references should be removed from the output entirely.
- Output JSON only.`;

async function handlePost(request: Request) {
  try {
    const input: RushInput = await request.json();

    if (!input.resumeText?.trim()) {
      return NextResponse.json(
        { error: "Resume text is required." },
        { status: 400 }
      );
    }
    if (!input.targetJob?.trim()) {
      return NextResponse.json(
        { error: "Target job title is required." },
        { status: 400 }
      );
    }

    // Strip incarceration-related content before sending to AI
    const cleanedResume = input.resumeText
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.]*\./gi, '')
      .replace(/(?:I was |was )?incarcerat(?:ed|ion)[^.]*\./gi, '')
      .replace(/(?:prison|jail|correctional|waupun|penitentiary|detention)[^.]*(?:program|vocational|course|certificate|kitchen|facility)[^.]*\./gi, '')
      .replace(/(?:parole|probat(?:ion|ionary))\s*(?:officer|agent|supervisor)?[^.]*\./gi, '')
      .replace(/(?:disciplinary|infraction|conduct)[^.]*(?:issue|record|report)[^.]*\./gi, '')
      .replace(/\d{4}\s*[-–—]\s*\d{4}\s*[-–—]\s*I was/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const userMessage = `Rewrite this resume for the target job.

TARGET JOB: ${input.targetJob}${input.targetCompany ? `\nTARGET COMPANY: ${input.targetCompany}` : ""}${input.jobDescription ? `\n\nJOB DESCRIPTION:\n${input.jobDescription.slice(0, 4000)}` : ""}

ORIGINAL RESUME:
${cleanedResume.slice(0, 6000)}

Return JSON:
{
  "summary": "2-3 sentence professional summary for the target job",
  "bullets": [
    { "text": "rewritten bullet with action verb", "original": "what it was based on from the original resume" }
  ],
  "skills": ["skill1", "skill2"],
  "tips": "One sentence of honest advice for this specific application"
}`;

    const startTime = Date.now();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Claude API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    const text = data.content[0]?.text || "";
    const latencyMs = Date.now() - startTime;
    const tokenCount = data.usage?.input_tokens + data.usage?.output_tokens;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in Claude response");

    const result = JSON.parse(jsonMatch[0]);

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "rush-resume",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: input.resumeText.slice(0, 500),
        explanation: `Rush resume rewrite for target job: ${input.targetJob}${input.targetCompany ? ` at ${input.targetCompany}` : ""}`,
        outputSummary: {
          type: "rush_resume",
          target_job: input.targetJob,
          target_company: input.targetCompany || null,
          bullets_count: result.bullets?.length ?? 0,
          skills_count: result.skills?.length ?? 0,
        },
        tokenCount: tokenCount ?? null,
        latencyMs,
      });
    } catch (err) {
      console.error("Decision log failed (rush-resume):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rush resume error:", error);
    return NextResponse.json(
      { error: error.message || "Something went wrong. Try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "rush-resume",
});
