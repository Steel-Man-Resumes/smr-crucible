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
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { isMockEnabled, MOCK_FORGE_OUTPUT } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";

export const maxDuration = 120;

// The Career Intelligence Report is a DEEP task (models.ts doctrine): the
// full narrative synthesis is the Forge's flagship one-shot output.
const AI_MODEL = MODEL_DEEP;

interface ForgeInput {
  resumeText?: string;
  readinessStage?: string;
  goals?: string[];
  goalNarrative?: string;
  hookNarrative?: string;
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
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // Zero-cost dev mode — return fixture data immediately
  if (isMockEnabled()) {
    return NextResponse.json({ ...MOCK_FORGE_OUTPUT, generated_at: new Date().toISOString() });
  }

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
      readiness_stage: input.readinessStage || "preparation",
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
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
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

/**
 * Readiness stage directives for the AI pipeline.
 * Each stage genuinely changes what the AI produces.
 */
const READINESS_DIRECTIVES: Record<string, {
  narrative: string;
  skills: string;
  careers: string;
  barriers: string;
  careerCount: string;
}> = {
  precontemplation: {
    narrative: `This person is EXPLORING. They are not committed to a job search yet.
- Write the headline as an identity statement, not a job target ("A problem-solver with hands-on expertise" not "Seeking warehouse position")
- Summary should feel like a mirror, not a sales pitch. Reflect who they are, not where they should apply.
- Reflection should validate that exploring is smart, not passive.
- Strengths: focus on transferable, identity-level strengths ("You lead naturally" not "Leadership skills applicable to management roles").`,
    skills: `This person is exploring, not actively job searching.
- Emphasize transferable and soft skills over hard/technical ones.
- Frame skills as personal assets, not resume keywords.
- Include skills they may not realize they have.`,
    careers: `This person is EXPLORING, not ready to apply.
- Suggest 2 paths max. Frame as "worth knowing about" not "you should apply to."
- Emphasize what the work IS (day-to-day), not next steps to get hired.
- Skip application timelines. They are not there yet.
- Salary ranges are helpful (shows their skills have market value) but don't frame as urgency.`,
    barriers: `This person is exploring. They are not ready for action steps.
- Name barriers gently. Connect to resources but frame as "these exist when you need them."
- Legal notes: provide the information but don't push them to act on it.
- Fewer resources per barrier (top 2 max). Quality over volume.`,
    careerCount: "2",
  },
  contemplation: {
    narrative: `This person is THINKING ABOUT IT. They know they need to do something but feel stuck.
- Headline should name their direction without locking them in.
- Summary should acknowledge both their experience AND their ambivalence. "You have more to work with than you think."
- Reflection should validate that thinking is not wasted time — and gently point toward a next small step.
- Strengths: connect to possibilities. "This strength opens doors in X and Y." Frame strengths as the foundation of a future identity, not just resume bullets.`,
    skills: `This person is weighing their options.
- Full skill extraction, but frame transferable skills prominently.
- For each skill cluster, hint at what industries value it.
- Include implied skills generously. They need to see they have more than they think.`,
    careers: `This person is THINKING, not applying.
- Suggest 3 paths, ranging from accessible to aspirational.
- Frame as "options worth considering" with a sense of possibility.
- For each path, include what Giordano calls a "hook": a specific program, org, or entry point in this field where someone could build a relationship — not just find a job.
- Include what makes each path a good FIT for them specifically.
- Next steps should be low-commitment ("learn more about..." not "apply to...").
- Salary ranges help them see the upside.`,
    barriers: `This person is thinking but not acting.
- Name barriers honestly. Connect each to resources.
- Frame resources as "when you're ready, here's where to start."
- Legal notes: clear and informative. Knowledge is power even before action.
- 2-3 resources per barrier. At least one should be a potential "hook for change" — a program or org that builds relationships, not just delivers services.`,
    careerCount: "3",
  },
  preparation: {
    narrative: `This person has DECIDED to make a change. They need a plan.
- Headline should be resume-ready and targeted.
- Summary should be confident and forward-looking. This IS the replacement self Giordano describes — help them see it.
- Reflection should celebrate the decision and reinforce the identity shift: they are not "someone trying to get a job," they are a professional in a specific field.
- Strengths: tie directly to target career paths with specific evidence. Frame as proof of the new identity.`,
    skills: `This person is getting ready to move.
- Full skill extraction with resume-ready language.
- Categorize clearly (hard/soft/transferable) for resume building.
- Flag high-value skills that should be featured prominently.
- Include industry keywords where natural.`,
    careers: `This person is PREPARING to act.
- Suggest 3-5 paths with concrete detail.
- For the top path, identify the specific "hook" — an org, program, or employer in their area that could be both a job opportunity AND a genuine turning-point relationship.
- Include specific next steps (certifications to get, organizations to contact, people to meet).
- Salary ranges with growth potential ("starts at X, moves to Y within 2 years").
- Note which paths have the lowest barrier to entry for their situation.
- Name structural obstacles honestly (background check timing, licensing exclusions) and how to navigate them.`,
    barriers: `This person is preparing to move. They need actionable plans.
- Full resource lists with contact info where possible.
- Legal notes: specific to their situation, actionable.
- Timelines only as general ballpark, framed to verify ("record-clearing can take months and it varies -- a legal-aid resource can confirm for your case"), never a firm promise.
- Frame through agency: "here's what you do first."
- Name the structural reality (Pager's research) and the navigation: "Employers can discriminate even where ban-the-box applies. Here's how to get ahead of it."
- At least one resource per barrier should be a potential "hook" org where a relationship can form, not just a service.`,
    careerCount: "3-5",
  },
  action: {
    narrative: `This person is READY TO GO. They are actively looking for work.
- Headline must be resume-ready, keyword-rich, and targeted to their strongest career path.
- Summary should read like a professional brand statement an employer would respond to.
- Reflection can be brief — they have made the identity shift. Reinforce it: "You're not job-searching. You're connecting your skills to the right employer."
- Strengths: frame as competitive advantages with specific evidence and metrics.`,
    skills: `This person is actively job searching.
- Comprehensive extraction with ATS-optimized language.
- Categorize precisely. Flag which skills map to which career paths.
- Include industry-standard terminology and certifications.
- Prioritize hard skills and quantifiable competencies.`,
    careers: `This person is READY and actively searching.
- Suggest 3-5 paths with maximum actionable detail.
- For each path: name specific fair-chance employers in their area. SHRM data shows 85% of HR pros say JI employees perform equal or better — this person should know that data exists.
- Next steps should be specific and immediate ("apply on Indeed this week", "call this organization Monday").
- Salary ranges with negotiation context.
- Note seasonal hiring patterns if relevant.
- Address the structural barrier upfront for each path: what the background check process looks like, timing of disclosure, which employers use individual assessment.`,
    barriers: `This person is actively applying and needs barrier solutions NOW.
- Maximum resource depth. Real organizations, real contact info.
- Legal notes: specific, actionable, with deadlines if applicable.
- Include "what to say when asked" disclosure strategies.
- Prioritize resources by immediacy and impact.
- Frame barriers as solvable logistics, not identity: "The system has this obstacle. Here is exactly how to move through it."
- Include fair-chance employer intelligence — which specific companies in their area have publicly committed to fair hiring.`,
    careerCount: "3-5",
  },
};

function getReadinessDirective(stage?: string) {
  return READINESS_DIRECTIVES[stage || "preparation"] || READINESS_DIRECTIVES.preparation;
}

function buildContext(input: ForgeInput): string {
  const parts: string[] = [];

  if (input.readinessStage) {
    const stageLabels: Record<string, string> = {
      precontemplation: "Exploring (not ready to search yet)",
      contemplation: "Thinking about it (knows they need to, not sure how)",
      preparation: "Getting ready (decided to make a change)",
      action: "Ready to go (actively looking for work)",
    };
    parts.push(`READINESS STAGE: ${stageLabels[input.readinessStage] || input.readinessStage}`);
  }

  if (input.resumeText) {
    parts.push(`RESUME:\n${sanitizeForPrompt(input.resumeText, 6000)}`);
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${sanitizeArray(input.goals)}`);
  }
  if (input.goalNarrative) {
    parts.push(`GOAL NARRATIVE: ${sanitizeForPrompt(input.goalNarrative, 1000)}`);
  }
  if (input.hookNarrative) {
    parts.push(`HOOK FOR CHANGE (what would make work feel meaningful — Giordano's turning-point context): ${sanitizeForPrompt(input.hookNarrative, 1000)}`);
  }

  if (input.challenges?.length) {
    parts.push(`CHALLENGES: ${sanitizeArray(input.challenges)}`);
  }
  if (input.challengeNarratives) {
    for (const [key, value] of Object.entries(input.challengeNarratives)) {
      if (value) parts.push(`CHALLENGE DETAIL (${sanitizeForPrompt(key, 100)}): ${sanitizeForPrompt(value, 1000)}`);
    }
  }

  if (input.criminalRecord?.type) {
    const cr = input.criminalRecord;
    parts.push(
      `CRIMINAL RECORD: ${sanitizeForPrompt(cr.type)}, ${sanitizeForPrompt(cr.charge_count)} charge(s), most recent: ${sanitizeForPrompt(cr.most_recent)}, supervision: ${sanitizeForPrompt(cr.supervision)}`
    );
    if (cr.context) parts.push(`CONTEXT: ${sanitizeForPrompt(cr.context, 1000)}`);
  }

  if (input.preferences) {
    const p = input.preferences;
    parts.push(
      `PREFERENCES: schedule=${sanitizeForPrompt(p.schedule) || "any"}, environment=${sanitizeForPrompt(p.environment) || "any"}, commute=${sanitizeForPrompt(p.commute) || "any"}, location=${sanitizeForPrompt(p.location)}`
    );
    // Extract state for jurisdiction-specific barrier analysis
    if (p.location) {
      const stateMatch = sanitizeForPrompt(p.location, 200).match(/,\s*([A-Z]{2})$/);
      if (stateMatch) {
        parts.push(`JURISDICTION: ${stateMatch[1]} (use for ban-the-box laws, expungement rules, and fair-chance ordinances)`);
      }
    }
  }

  return parts.join("\n\n");
}

async function callClaude(
  systemPrompt: string,
  userMessage: string
): Promise<Record<string, unknown>> {
  const text = await callAI(systemPrompt, [{ role: "user", content: userMessage }], 4000, MODEL_DEEP, { endpoint: "analyze" });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in AI response");
  return JSON.parse(jsonMatch[0]);
}

// --- Step 1 & 2: Narrative Analysis ---

async function analyzeNarrative(
  context: string,
  input: ForgeInput
): Promise<Record<string, unknown>> {
  const rd = getReadinessDirective(input.readinessStage);

  const system = `You are a career narrative analyst for Steel Man Resumes.
Your job is to find the strengths and professional story in this person's experience.

READINESS-AWARE INSTRUCTIONS:
${rd.narrative}

RULES:
- Use the person's OWN words and experiences. Never fabricate.
- Frame strengths, not deficits.
- Write at a 6th grade reading level.
- Never judge, score, or grade.
- The headline and summary should be RESUME-READY. They may appear on actual job applications. Therefore:
  - NEVER mention incarceration, prison, jail, correctional facilities, parole, probation, criminal records, "time away", "time served", re-entry, or any reference to justice involvement -- not even obliquely or with euphemisms like "during his time away" or "while building new skills in a structured environment."
  - Focus purely on professional skills, experience, education, and certifications.
  - If education/certs were earned in prison, just list them without mentioning where. "GED, 2021" not "GED earned at Waupun Correctional."
- The "reflection" field is private (shown only to the user) -- this CAN acknowledge their full journey with warmth.
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
  const rd = getReadinessDirective(input.readinessStage);

  const system = `You extract skills from resumes and user narratives.
Categorize as hard (technical/certifiable), soft (interpersonal), or transferable (cross-industry).
Be generous -- include skills implied by experience, not just explicitly stated.

READINESS-AWARE INSTRUCTIONS:
${rd.skills}

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
  const rd = getReadinessDirective(input.readinessStage);

  const system = `You are a career path researcher specializing in fair-chance employment.
Match this person's skills, experience, goals, and situation to realistic career paths.

READINESS-AWARE INSTRUCTIONS:
${rd.careers}

RULES:
- Suggest ${rd.careerCount} paths, from most accessible to stretch goals.
- Consider their barriers (if any) and suggest paths where those barriers matter least.
- Include concrete next steps for each path.
- No blue-collar assumptions -- match based on actual skills and interests.
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
  const rd = getReadinessDirective(input.readinessStage);

  const system = `You are a reentry resource specialist grounded in evidence-based practice.

CORE FRAMING (non-negotiable):
Barriers are structural obstacles and logistics to navigate — not character flaws or personal failures.
Devah Pager's audit studies showed that discrimination in hiring is measurable and systematic.
Your job is to arm this person with real resources, legal rights, and navigation strategies — not to help them feel better about a system that is genuinely unfair to them.

At the same time: Giordano et al. (2002) showed that lasting change requires both a concrete "hook" (a job, a program, a mentor) AND identity work. For each barrier, surface potential hooks — organizations and programs where the person might find not just a service, but a connection that could become a turning point.

For each barrier this person faces, provide:
- Practical resources and organizations that help
- Legal context where relevant (ban-the-box, fair chance laws) — be jurisdiction-specific when the state is known
- Specific, actionable next steps
- At least one potential "hook for change" — an org or program where this person could build a relationship, not just receive a service

READINESS-AWARE INSTRUCTIONS:
${rd.barriers}

RULES:
- Be specific, not generic. Real organizations > generic advice.
- For criminal records: consider type, recency, and jurisdiction. Reference laws as GENERAL INFORMATION to verify, never as a determination of THIS person's eligibility.
- LEGAL DISCIPLINE (non-negotiable): legal_notes is career coaching, not legal advice. Never tell the person their specific charge "qualifies" or "does not qualify" for expungement, sealing, or relief -- say a legal-aid resource can assess whether it applies to them. Describe protections generally; cite a statute only as "a law such as X exists," never as settled individual eligibility. Never invent statutes, numbers, deadlines, or eligibility rules.
- Employer incentives: NEVER cite the Work Opportunity Tax Credit (WOTC) as a current incentive -- it expired for hires beginning after 2025-12-31 (Form 8850 retired). The Federal Bonding Program is the current program; mention it generally if relevant, and never present any incentive as settled without verification.
- Wisconsin (only if the jurisdiction is WI): ban-the-box applies to state/county government employers; Milwaukee city has an ordinance extending to private employers with 15+. An expungement statute (WI §973.015) exists -- note that a legal-aid resource can assess whether it applies; do NOT assert the person's own eligibility.
- Never minimize barriers, but always connect to solutions.
- Frame through agency: what the person CAN do.
- "The system has real obstacles here. Here's how to move through them." — not "don't worry about it."
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
