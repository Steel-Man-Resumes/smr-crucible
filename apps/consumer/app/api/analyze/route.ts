/**
 * Narrative Analysis Pipeline API
 *
 * Runs the 6-step Forge analysis pipeline:
 * 1. Skills extraction (from resume + free text)
 * 2. Narrative analysis (redemption framing, strengths identification)
 * 3. Career path research
 * 4. Barrier-to-resource matching
 * 5. Record-aware legal navigation
 * 6. Forge output composition
 *
 * Each step logged to decision_log with explanation.
 * Ported prompts from smr-forge/app/api/analyze/route.ts, rewritten
 * for the new vision (empowerment, not sales).
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 120;

interface ForgeInput {
  resumeText?: string;
  readinessStage?: string;
  goals?: string[];
  goalNarrative?: string;
  challenges?: string[];
  criminalRecord?: {
    type: string;
    charge_count: string;
    most_recent: string;
    supervision: string;
    context: string;
  };
  challengeNarratives?: Record<string, string>;
  preferences?: Record<string, string>;
  sessionId?: string;
}

async function handlePost(request: Request) {
  try {
    const input: ForgeInput = await request.json();

    // Build context string from all user input
    const context = buildContext(input);

    // Run analysis phases in parallel
    const [narrative, skills, careerPaths, barriers] = await Promise.all([
      analyzeNarrative(context, input),
      extractSkills(context, input),
      findCareerPaths(context, input),
      input.challenges?.length
        ? analyzeBarriers(context, input)
        : Promise.resolve(null),
    ]);

    // Compose the Forge output
    const forgeOutput = {
      schema_version: "forge_output.v1",
      generated_at: new Date().toISOString(),
      narrative,
      strengths: narrative.strengths || [],
      skills: skills.skills || [],
      career_paths: careerPaths.paths || [],
      barriers: barriers?.barriers || [],
    };

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        sessionId: input.sessionId ?? null,
        contextPage: "analyze",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: context.slice(0, 500),
        explanation: "Generated Forge career analysis from resume, goals, barriers, and preferences",
        outputSummary: {
          type: "forge_analysis",
          strengths_count: (narrative.strengths as unknown[])?.length ?? 0,
          skills_count: (skills.skills as unknown[])?.length ?? 0,
          career_paths_count: (careerPaths.paths as unknown[])?.length ?? 0,
          barriers_count: (barriers?.barriers as unknown[])?.length ?? 0,
        },
      });
    } catch (err) {
      console.error("Decision log failed (analyze):", err);
    }

    return NextResponse.json(forgeOutput);
  } catch (error: any) {
    console.error("Analysis pipeline error:", error);
    return NextResponse.json(
      { error: "Analysis failed. Please try again." },
      { status: 500 }
    );
  }
}

function buildContext(input: ForgeInput): string {
  const parts: string[] = [];

  if (input.resumeText) {
    parts.push(`RESUME:\n${input.resumeText.slice(0, 6000)}`);
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${input.goals.join(", ")}`);
  }
  if (input.goalNarrative) {
    parts.push(`GOAL NARRATIVE: ${input.goalNarrative}`);
  }

  if (input.challenges?.length) {
    parts.push(`CHALLENGES: ${input.challenges.join(", ")}`);
  }
  if (input.challengeNarratives) {
    for (const [key, value] of Object.entries(input.challengeNarratives)) {
      if (value) parts.push(`CHALLENGE DETAIL (${key}): ${value}`);
    }
  }

  if (input.criminalRecord?.type) {
    const cr = input.criminalRecord;
    parts.push(
      `CRIMINAL RECORD: ${cr.type}, ${cr.charge_count} charge(s), most recent: ${cr.most_recent}, supervision: ${cr.supervision}`
    );
    if (cr.context) parts.push(`CONTEXT: ${cr.context}`);
  }

  if (input.preferences) {
    const p = input.preferences;
    parts.push(
      `PREFERENCES: schedule=${p.schedule || "any"}, environment=${p.environment || "any"}, commute=${p.commute || "any"}, location=${p.location || "not specified"}`
    );
  }

  return parts.join("\n\n");
}

async function callClaude(
  systemPrompt: string,
  userMessage: string
): Promise<Record<string, unknown>> {
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
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = data.content[0]?.text || "";

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response");

  return JSON.parse(jsonMatch[0]);
}

// --- Step 1 & 2: Narrative Analysis ---

async function analyzeNarrative(
  context: string,
  input: ForgeInput
): Promise<Record<string, unknown>> {
  const system = `You are a career narrative analyst for Steel Man Resumes.
Your job is to find the strengths and professional story in this person's experience.

RULES:
- Use the person's OWN words and experiences. Never fabricate.
- Frame strengths, not deficits.
- Write at a 6th grade reading level.
- Never judge, score, or grade.
- The headline and summary should be RESUME-READY. They may appear on actual job applications. Therefore:
  - NEVER mention incarceration, prison, jail, correctional facilities, parole, probation, criminal records, "time away", "time served", re-entry, or any reference to justice involvement — not even obliquely or with euphemisms like "during his time away" or "while building new skills in a structured environment."
  - Focus purely on professional skills, experience, education, and certifications.
  - If education/certs were earned in prison, just list them without mentioning where. "GED, 2021" not "GED earned at Waupun Correctional."
- The "reflection" field is private (shown only to the user) — this CAN acknowledge their full journey with warmth.
- Output JSON only.`;

  const prompt = `Analyze this person's story and create their narrative.

${context}

Return JSON:
{
  "headline": "A one-sentence summary of who this person is professionally (positive, specific)",
  "summary": "2-3 sentence narrative about their strengths, experience, and what they bring to an employer. Use their words.",
  "reflection": "A sentence that mirrors back something they shared, validating it.",
  "strengths": [
    { "title": "strength name", "evidence": "specific thing from their history", "source": "resume|narrative|ai_inferred" }
  ]
}`;

  try {
    return await callClaude(system, prompt);
  } catch (error) {
    console.error("Narrative analysis failed:", error);
    return {
      headline: "Your experience tells a strong story.",
      summary: "Based on what you've shared, you bring real-world skills and determination.",
      strengths: [],
    };
  }
}

// --- Step 1b: Skills Extraction ---

async function extractSkills(
  context: string,
  input: ForgeInput
): Promise<Record<string, unknown>> {
  const system = `You extract skills from resumes and user narratives.
Categorize as hard (technical/certifiable), soft (interpersonal), or transferable (cross-industry).
Be generous — include skills implied by experience, not just explicitly stated.
Output JSON only.`;

  const prompt = `Extract all skills from this person's experience.

${context}

Return JSON:
{
  "skills": [
    { "name": "skill name", "category": "hard|soft|transferable" }
  ]
}`;

  try {
    return await callClaude(system, prompt);
  } catch (error) {
    console.error("Skills extraction failed:", error);
    return { skills: [] };
  }
}

// --- Step 3: Career Path Research ---

async function findCareerPaths(
  context: string,
  input: ForgeInput
): Promise<Record<string, unknown>> {
  const system = `You are a career path researcher specializing in fair-chance employment.
Match this person's skills, experience, goals, and situation to realistic career paths.

RULES:
- Suggest 3-5 paths, from most accessible to stretch goals.
- Consider their barriers (if any) and suggest paths where those barriers matter least.
- Include concrete next steps for each path.
- No blue-collar assumptions — match based on actual skills and interests.
- Be honest about salary ranges.
- Output JSON only.`;

  const prompt = `Find career paths for this person.

${context}

Return JSON:
{
  "paths": [
    {
      "title": "job title or career area",
      "industry": "industry",
      "match_reason": "why this fits based on their specific experience",
      "salary_range": "$XX,000-$XX,000/year",
      "next_steps": ["step 1", "step 2", "step 3"]
    }
  ]
}`;

  try {
    return await callClaude(system, prompt);
  } catch (error) {
    console.error("Career path research failed:", error);
    return { paths: [] };
  }
}

// --- Step 4 & 5: Barrier Analysis + Legal Navigation ---

async function analyzeBarriers(
  context: string,
  input: ForgeInput
): Promise<Record<string, unknown>> {
  const system = `You are a reentry resource specialist.
For each barrier this person faces, provide:
- Practical resources and organizations that help
- Legal context where relevant (ban-the-box, fair chance laws)
- Specific, actionable next steps

RULES:
- Be specific, not generic. Real organizations > generic advice.
- For criminal records: consider type, recency, and jurisdiction.
- Never minimize barriers, but always connect to solutions.
- Frame through agency: what the person CAN do.
- Output JSON only.`;

  const prompt = `Analyze barriers and find resources for this person.

${context}

Return JSON:
{
  "barriers": [
    {
      "type": "barrier type",
      "user_narrative": "what they said about it (brief quote or summary)",
      "resources": [
        { "name": "org/resource name", "type": "category", "description": "what they offer and how to access" }
      ],
      "legal_notes": "relevant laws or rights (ban-the-box, expungement eligibility, etc.)"
    }
  ]
}`;

  try {
    return await callClaude(system, prompt);
  } catch (error) {
    console.error("Barrier analysis failed:", error);
    return { barriers: [] };
  }
}

export const POST = withRateLimit(handlePost, { mode: "ip", endpoint: "analyze" });
