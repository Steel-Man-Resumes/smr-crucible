/**
 * Document Generation API — Resume + Cover Letter from Forge Output
 *
 * Takes Forge analysis data (narrative, strengths, skills, career paths, barriers)
 * plus optional original resume text. Returns structured resume + cover letter text.
 *
 * IP rate-limited (5/day), decision-logged.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 120;

interface GenerateDocsInput {
  narrative?: {
    headline?: string;
    summary?: string;
    reflection?: string;
    strengths?: Array<{ title: string; evidence: string; source: string }>;
  };
  strengths?: Array<{ title: string; evidence: string; source: string }>;
  skills?: Array<{ name: string; category: string }>;
  career_paths?: Array<{
    title: string;
    industry?: string;
    match_reason: string;
    salary_range?: string;
    next_steps: string[];
  }>;
  barriers?: Array<{
    type: string;
    user_narrative?: string;
    legal_notes?: string;
  }>;
  resumeText?: string;
  goals?: string[];
  goalNarrative?: string;
  preferences?: Record<string, string>;
  sessionId?: string;
}

async function handlePost(request: Request) {
  try {
    const input: GenerateDocsInput = await request.json();

    if (!input.narrative && !input.strengths && !input.skills?.length) {
      return NextResponse.json(
        { error: "No Forge output data provided. Run the analysis first." },
        { status: 400 }
      );
    }

    const startTime = Date.now();

    // Generate resume and cover letter in parallel
    const [resume, coverLetter] = await Promise.all([
      generateResume(input),
      generateCoverLetter(input),
    ]);

    const latencyMs = Date.now() - startTime;

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        sessionId: input.sessionId ?? null,
        contextPage: "generate-docs",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: JSON.stringify({
          has_resume: !!input.resumeText,
          strengths_count: (input.strengths || input.narrative?.strengths || []).length,
          skills_count: (input.skills || []).length,
          career_paths_count: (input.career_paths || []).length,
        }),
        explanation:
          "Generated resume and cover letter documents from Forge analysis output",
        outputSummary: {
          type: "document_generation",
          resume_length: resume.length,
          cover_letter_length: coverLetter.length,
        },
        latencyMs,
      });
    } catch (err) {
      console.error("Decision log failed (generate-docs):", err);
    }

    return NextResponse.json({
      resume,
      coverLetter,
      generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Document generation error:", error);
    return NextResponse.json(
      { error: "Document generation failed. Please try again." },
      { status: 500 }
    );
  }
}

// --- Claude API helper ---

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4000
): Promise<string> {
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
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.content[0]?.text || "";
}

// --- Resume Generation ---

async function generateResume(input: GenerateDocsInput): Promise<string> {
  const strengths = input.strengths || input.narrative?.strengths || [];
  const skills = input.skills || [];
  const careerPaths = input.career_paths || [];
  const narrative = input.narrative || {};

  const system = `You are a professional resume writer for Steel Man Resumes. You write resumes for people re-entering the workforce who deserve to lead with their strengths.

RULES:
- Use ONLY facts from the provided data. Never fabricate experience, jobs, or credentials.
- If there's original resume text, use it as the primary source of work history and education.
- If there's NO resume, build from strengths, skills, goals, and narrative data.
- Write at a professional level but keep it clear and readable.
- NEVER mention incarceration, criminal records, convictions, justice involvement, prison, jail, re-entry, parole, probation, or any disqualifying information. Not even obliquely. Not even with growth framing. This is a paper document and disclosure should ONLY happen in person during interviews.
- For employment gaps, simply omit dates or use a functional/skills-based format. Do NOT explain gaps.
- If the user's data mentions incarceration or justice involvement, ignore those details entirely for the resume. Focus on skills, experience, education, and certifications.
- Include a professional summary, core skills, and relevant experience sections.
- Output clean, formatted plain text ready for copy-paste or DOCX conversion.`;

  const parts: string[] = [];

  if (narrative.headline) parts.push(`NARRATIVE HEADLINE: ${narrative.headline}`);
  if (narrative.summary) parts.push(`NARRATIVE SUMMARY: ${narrative.summary}`);

  if (strengths.length > 0) {
    parts.push(
      `STRENGTHS:\n${strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (skills.length > 0) {
    const hard = skills.filter((s) => s.category === "hard").map((s) => s.name);
    const soft = skills.filter((s) => s.category === "soft").map((s) => s.name);
    const transferable = skills
      .filter((s) => s.category === "transferable")
      .map((s) => s.name);
    parts.push(
      `SKILLS:\n- Technical: ${hard.join(", ") || "None identified"}\n- People: ${soft.join(", ") || "None identified"}\n- Transferable: ${transferable.join(", ") || "None identified"}`
    );
  }

  if (careerPaths.length > 0) {
    parts.push(
      `TARGET CAREER PATHS:\n${careerPaths.map((cp) => `- ${cp.title} (${cp.industry || "various"})`).join("\n")}`
    );
  }

  if (input.resumeText) {
    // Strip any incarceration-related content from the resume text before sending to AI
    const cleanedResume = input.resumeText
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.]*\./gi, '')
      .replace(/(?:incarcerat|prison|jail|parole|probat|correct(?:ion|ional)|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon|convict)[^.]*\./gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    parts.push(`ORIGINAL RESUME TEXT:\n${cleanedResume.slice(0, 6000)}`);
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${input.goals.join(", ")}`);
  }
  if (input.goalNarrative) {
    parts.push(`GOAL NARRATIVE: ${input.goalNarrative}`);
  }

  if (input.preferences) {
    const p = input.preferences;
    if (p.location) parts.push(`PREFERRED LOCATION: ${p.location}`);
  }

  const prompt = `Write a professional resume using the data below. Format it as clean plain text with clear section headers.

${parts.join("\n\n")}

FORMAT:
[FULL NAME or "CANDIDATE" if unknown]
[Branded headline — one powerful line about who they are professionally]

PROFESSIONAL SUMMARY
[2-4 sentences synthesizing their experience, strengths, and career direction]

CORE COMPETENCIES
[Skills organized by category, separated by |]

PROFESSIONAL EXPERIENCE
[Each role: TITLE | Company | Dates
- Achievement bullet points with metrics where available]

EDUCATION & CERTIFICATIONS
[Any education or certs from the resume, or "Available upon request" if none]

IMPORTANT:
- If no work history is provided, create a FUNCTIONAL resume organized by skill areas instead of chronological experience.
- Every bullet point must come from real data — never invent.
- Keep it to 1 page worth of content (roughly 400-600 words).
- Do NOT include placeholder brackets like [Your Name] — use real data or omit.`;

  return await callClaude(system, prompt);
}

// --- Cover Letter Generation ---

async function generateCoverLetter(input: GenerateDocsInput): Promise<string> {
  const strengths = input.strengths || input.narrative?.strengths || [];
  const skills = input.skills || [];
  const careerPaths = input.career_paths || [];
  const barriers = input.barriers || [];
  const narrative = input.narrative || {};

  const system = `You are a cover letter writer for Steel Man Resumes. You write compelling, confident cover letters for people re-entering the workforce.

RULES:
- Write a GENERIC cover letter template, not targeted to a specific employer.
- The letter should work for any employer in their target career path(s).
- Use [Company Name] and [Hiring Manager] as placeholders ONLY for the employer name and contact.
- Everything else must use REAL data from the person's profile.
- 250-350 words. Professional tone with warmth.
- NEVER mention incarceration, criminal records, convictions, justice involvement, prison, jail, re-entry, parole, probation, or any disqualifying information in the cover letter. Disclosure happens in person during interviews, never on paper.
- Do NOT explain employment gaps. Simply focus on what the candidate brings.
- Never fabricate achievements or experience.`;

  const parts: string[] = [];

  if (narrative.headline) parts.push(`ABOUT: ${narrative.headline}`);
  if (narrative.summary) parts.push(`SUMMARY: ${narrative.summary}`);

  if (strengths.length > 0) {
    parts.push(
      `KEY STRENGTHS:\n${strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (skills.length > 0) {
    parts.push(`TOP SKILLS: ${skills.slice(0, 10).map((s) => s.name).join(", ")}`);
  }

  if (careerPaths.length > 0) {
    parts.push(
      `TARGET CAREER AREA: ${careerPaths[0].title} (${careerPaths[0].industry || "various industries"})`
    );
  }

  // NEVER include barriers in written documents. Disclosure happens in interviews only.

  if (input.resumeText) {
    // Strip incarceration-related content before sending to AI
    const cleanedResume = input.resumeText
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.]*\./gi, '')
      .replace(/(?:incarcerat|prison|jail|parole|probat|correct(?:ion|ional)|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon|convict)[^.]*\./gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    parts.push(
      `WORK HISTORY EXCERPT:\n${cleanedResume.slice(0, 3000)}`
    );
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${input.goals.join(", ")}`);
  }

  const prompt = `Write a professional cover letter using the data below.

${parts.join("\n\n")}

FORMAT (plain text):
Dear [Hiring Manager],

[Opening paragraph: who you are, what role you're pursuing, and why]

[Middle paragraph(s): your strongest qualifications, specific achievements, and what you bring]

[Closing paragraph: enthusiasm, availability, call to action]

Sincerely,
[Name from resume or "Candidate"]

IMPORTANT:
- Use [Company Name] and [Hiring Manager] as the ONLY placeholders.
- Everything else must be real — real skills, real achievements, real strengths.
- 250-350 words for the body.
- Address barriers in ONE natural sentence if applicable, otherwise omit entirely.`;

  return await callClaude(system, prompt);
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "generate-docs",
});
