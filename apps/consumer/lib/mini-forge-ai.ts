/**
 * Mini Forge AI processing.
 *
 * Uses Haiku 4.5 (fastest/cheapest). Non-streaming -- deferred batch call.
 * Uses raw fetch to Anthropic API (same pattern as analyze route).
 * With MOCK_AI=true: returns Jordan fixture instantly.
 */

import { isMockEnabled, MOCK_FORGE_OUTPUT } from "./mock-ai";
import { RESEARCH_CONTEXT } from "./research-context";

export interface MiniForgeIntake {
  readiness_stage?: string;
  goals?: string[];
  challenges?: string[];
  work_type?: string;
  skills?: string[];
  skills_freetext?: string;
  location?: string;
  hook_narrative?: string;
}

export async function processMiniForge(
  intake: MiniForgeIntake
): Promise<Record<string, unknown>> {
  if (isMockEnabled()) {
    return { ...MOCK_FORGE_OUTPUT, generated_at: new Date().toISOString(), source: "mock" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const prompt = buildPrompt(intake);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: MINI_FORGE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { generated_at: new Date().toISOString(), raw_text: text, parse_error: true };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, generated_at: new Date().toISOString() };
  } catch {
    return { generated_at: new Date().toISOString(), raw_text: text, parse_error: true };
  }
}

function buildPrompt(intake: MiniForgeIntake): string {
  const parts: string[] = [];

  if (intake.readiness_stage) {
    const stageMap: Record<string, string> = {
      precontemplation: "not thinking about work yet",
      contemplation: "thinking about it but not sure",
      preparation: "getting ready, taking steps",
      action: "actively looking for work",
    };
    parts.push(`Readiness: ${stageMap[intake.readiness_stage] ?? intake.readiness_stage}`);
  }

  if (intake.goals?.length) {
    parts.push(`Work goals: ${intake.goals.join(", ")}`);
  }

  if (intake.challenges?.length) {
    parts.push(`Challenges: ${intake.challenges.join(", ")}`);
  }

  if (intake.work_type) {
    parts.push(`Work environment preference: ${intake.work_type}`);
  }

  if (intake.skills?.length || intake.skills_freetext) {
    const skillList = intake.skills ?? [];
    if (intake.skills_freetext) skillList.push(intake.skills_freetext);
    parts.push(`Skills: ${skillList.join(", ")}`);
  }

  if (intake.location) {
    parts.push(`Location: ${intake.location}`);
  }

  if (intake.hook_narrative) {
    parts.push(`What would make work feel like theirs: "${intake.hook_narrative}"`);
  }

  return `Person's career intake:\n${parts.join("\n")}\n\nGenerate a JSON career analysis following the schema in the system prompt.`;
}

const MINI_FORGE_SYSTEM = `You are a trauma-informed career counselor helping justice-impacted individuals plan their return to work. You write at a 5th grade reading level -- clear, warm, practical.

${RESEARCH_CONTEXT.slice(0, 1000)}

Respond ONLY with valid JSON matching this schema:
{
  "schema_version": "mini_forge.v1",
  "career_paths": [
    {
      "title": "Job Title",
      "industry": "Industry Name",
      "match_reason": "Why this fits them. Plain language. 1-2 sentences.",
      "salary_range": "$XX,000-$XX,000/year",
      "next_steps": ["Action 1", "Action 2", "Action 3"]
    }
  ],
  "skills": ["Skill 1", "Skill 2"],
  "headline": "Short professional summary sentence",
  "barrier_resources": [
    {
      "barrier": "barrier type",
      "resource": "Organization name -- what they do and how to reach them"
    }
  ],
  "resume_starter": "Two short paragraphs. No contact info. Just strengths + experience summary."
}

Rules:
- 2-3 career paths
- No external links -- resources as plain text only
- No tel: links -- phone numbers as plain text
- Fair chance employers preferred in next steps
- Never mention the word "felon" or "offender"
- If criminal record is a challenge, include a legal resource for the location
- 5th grade reading level throughout`;
