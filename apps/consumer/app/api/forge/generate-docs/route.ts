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
import { buildFullContext, userContextFromForge } from "@/lib/context-library";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { verifyGrounding, buildTrustedSource } from "@/lib/grounding-verify";

export const maxDuration = 120;

// Forge resume + cover letter generation is a DEEP task (models.ts doctrine):
// one-shot documents whose quality changes a real outcome.
const AI_MODEL = MODEL_DEEP;

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
  readinessStage?: string;
  // Self-disclosure (F2 s.2.3): the user's own read on their resume + worries.
  resumeConfidence?: "none" | "rough" | "decent" | "strong";
  resumeWorries?: string[];
  sessionId?: string;
}

// Translate the self-disclosure signal into a generation-mode directive. This
// biases sharpen-vs-scaffold and what to be sensitive to -- it never licenses
// invention (the TRUTH GATE + verifier still bound the output).
function selfDisclosureDirective(input: GenerateDocsInput): string {
  const bits: string[] = [];
  const conf = input.resumeConfidence;
  if (conf === "none" || conf === "rough") {
    bits.push(
      "The person rates their own history as thin/rough. Lead with a functional, skills-forward structure and narrative scaffolding built from real transferable skills. A shorter, sparser, TRUE resume is correct here -- never pad with invented detail to make it look fuller."
    );
  } else if (conf === "strong") {
    bits.push(
      "The person rates their history as strong. Sharpen and tighten what is already there; do not over-explain or inflate."
    );
  }
  const worries = new Set(input.resumeWorries || []);
  if (worries.has("gaps")) bits.push("They worry about employment gaps: use years only (never months), never explain a gap, and let strengths carry the story.");
  if (worries.has("job_changes")) bits.push("They worry about job changes: frame varied roles as range and adaptability, not instability.");
  if (worries.has("little_experience")) bits.push("They worry about limited experience: emphasize transferable skills, training, and any real accomplishments; a functional layout is fine.");
  return bits.length ? `\nSELF-DISCLOSURE (adapt accordingly, never invent):\n- ${bits.join("\n- ")}\n` : "";
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

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
    const [resumeRaw, coverLetterRaw] = await Promise.all([
      generateResume(input),
      generateCoverLetter(input),
    ]);

    // Post-generation grounding gate (F2): claim-trace each document back to what
    // the user actually gave us and strip/generalize anything invented. The prompt
    // TRUTH GATE is necessary but the model overrides it under thin inputs (Sol's
    // "buffers and scrubbers", "clean safety record"), so this AI verify pass is
    // load-bearing. Fail-open -- a verifier hiccup never blocks or mangles a resume.
    // Source = ONLY the user's own material (their resume text + their own words),
    // never the AI-derived narrative, so invention can't launder itself as source.
    const groundingSource = buildTrustedSource({
      resumeText: input.resumeText,
      userText: [input.goalNarrative, (input.goals || []).join(", ")],
    });

    const [resumeCheck, coverCheck] = await Promise.all([
      verifyGrounding({ sourceText: groundingSource, output: resumeRaw, kind: "resume" }),
      verifyGrounding({ sourceText: groundingSource, output: coverLetterRaw, kind: "cover_letter" }),
    ]);

    const resume = resumeCheck.text;
    const coverLetter = coverCheck.text;
    // Per-document accounting (Codex 8): a flag is "removed" only if THAT document's
    // rewrite was applied. A document that found fabrication but couldn't apply the
    // rewrite (window/floor/drop guard) has RESIDUAL fabrication the user must
    // review -- the notice must not claim it was removed.
    const checks = [resumeCheck, coverCheck];
    const removedCount = checks
      .filter((c) => c.applied)
      .reduce((n, c) => n + c.flags.length, 0);
    const residualCount = checks
      .filter((c) => c.hasFabrication && !c.applied)
      .reduce((n, c) => n + c.flags.length, 0);
    const groundingFlags = [...resumeCheck.flags, ...coverCheck.flags];
    const groundingApplied = resumeCheck.applied || coverCheck.applied;
    const hasFabrication = resumeCheck.hasFabrication || coverCheck.hasFabrication;

    const latencyMs = Date.now() - startTime;

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        sessionId: input.sessionId ?? null,
        contextPage: "generate-docs",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
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
          grounding_flags: groundingFlags.length,
          grounding_applied: groundingApplied,
        },
        latencyMs,
      });
    } catch (err) {
      console.error("Decision log failed (generate-docs):", err);
    }

    return NextResponse.json({
      resume,
      coverLetter,
      grounding: {
        hasFabrication,
        applied: groundingApplied,
        removed: removedCount,
        residual: residualCount,
        flags: groundingFlags,
      },
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
  return callAI(systemPrompt, [{ role: "user", content: userMessage }], maxTokens, MODEL_DEEP, { endpoint: "generate-docs" });
}

// --- Resume Generation ---

async function generateResume(input: GenerateDocsInput): Promise<string> {
  const strengths = input.strengths || input.narrative?.strengths || [];
  const skills = input.skills || [];
  const careerPaths = input.career_paths || [];
  const narrative = input.narrative || {};
  const isExploring = input.readinessStage === "precontemplation";

  // Inject research-backed context
  const researchCtx = buildFullContext("resume", userContextFromForge({
    forgeOutput: { narrative, strengths, skills, career_paths: careerPaths },
    readinessStage: input.readinessStage,
    resumeText: input.resumeText,
  }));

  const system = `${researchCtx}

You are a world-class professional resume writer. You produce resumes that compete at the highest level in professional resume writing for people re-entering the workforce.

YOUR JOB: Take whatever the user gives you -- even a terrible, bare-bones resume -- and produce a polished, compelling, TRUE resume that gets interviews and survives them.

ABSOLUTE RULES (the truth gate -- violating any = failure):
1. TRUTH GATE: use ONLY facts the source data states. NEVER invent a number, metric, tool, certification, employer, title, or result. NEVER estimate, infer, or borrow "industry typical" figures. If a detail is missing, write the bullet strong without it. This person's resume must survive a background-checked interview -- a true unquantified bullet beats an impressive false one.
2. Numbers ONLY where the source states them, kept exactly as given (ranges stay ranges).
3. NEVER "responsible for", "tasked with", "helped with", "assisted in", "participated in", "duties included". These are resume poison. Transform every one into achievement language built from stated facts.
4. NEVER use these AI-flagged words: utilize, facilitate, leverage, comprehensive, streamline, synergy, innovative, dynamic, proactive, dedicated, motivated, passionate, proven track record, results-driven, detail-oriented, team player. Write like a confident human.
5. ZERO first person ("I", "my", "me"). ZERO unnecessary articles in bullets.
6. Every bullet starts with a STRONG action verb: Led, Delivered, Reduced, Achieved, Built, Scaled, Trained, Maintained, Processed, Coordinated, Managed, Operated, Launched.
7. Past roles = past tense. Current role = present tense. No exceptions.
8. NEVER mention incarceration, criminal records, convictions, justice involvement, prison, jail, re-entry, parole, probation. Not even obliquely. Not even with growth framing.
9. For employment gaps: use YEARS ONLY (no months). NEVER explain gaps.
10. Keep to ONE PAGE (400-600 words). Every word fights for its seat.
11. Use "--" never an em dash anywhere in the output.

DATA CLEANING -- FIX INPUT ERRORS:
- If a job title doesn't match the company (e.g., retail cashier work attributed to a printing company), repair the pairing using context clues. Never invent a new employer or role.
- If dates look wrong or overlapping, use the most logical interpretation.
- If the resume is bare/terrible, produce the strongest TRUE resume the facts support: real duties as strong-verb bullets, skills the source supports, clean structure. Do NOT pad with invented achievements or metrics. An honest 3-bullet role beats a fabricated 5-bullet one.

${isExploring ? `This person is exploring, not actively job searching. Frame the value proposition as identity ("who you are") not targeting.` : ""}
${selfDisclosureDirective(input)}
SECTION ORDER (exact):
1. FULL NAME (all caps)
2. Contact line: City, State | Phone | Email (one line, pipe-separated)
3. Branded Headline (one powerful line — NOT an objective. An identity statement.)
4. CAREER SUMMARY (3-4 sentences. Who they are, what they bring, where they're headed. No generic filler.)
5. CORE COMPETENCIES (9-12 terms in 3 columns separated by |. No category labels. No "Hard Skills:" or "Soft Skills:". Just the terms. Pull from ACTUAL job content, not generic lists.)
6. PROFESSIONAL EXPERIENCE (reverse chronological)
   - Format: JOB TITLE | Company Name | City, State | Start Year - End Year
   - 3-5 CAR bullets per role, every one quantified
7. EDUCATION
   - Institution, dates. Add relevant coursework if it strengthens the resume.
8. CERTIFICATIONS (separate section if they have any — don't bury in education)

OUTPUT: Clean formatted plain text ready for DOCX conversion. No markdown. No brackets. No placeholders.`;

  const parts: string[] = [];

  if (narrative.headline) parts.push(`NARRATIVE HEADLINE: ${narrative.headline}`);
  if (narrative.summary) parts.push(`NARRATIVE SUMMARY: ${narrative.summary}`);

  if (strengths.length > 0) {
    parts.push(
      `STRENGTHS:\n${strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (skills.length > 0) {
    // Flatten skills into a single list — no category labels in the resume
    const allSkills = skills.map((s) => s.name).filter(Boolean);
    parts.push(`SKILLS (use for Core Competencies grid, no category labels):\n${allSkills.join(", ")}`);
  }

  if (careerPaths.length > 0) {
    parts.push(
      `TARGET CAREER PATHS:\n${careerPaths.map((cp) => `- ${cp.title} (${cp.industry || "various"})`).join("\n")}`
    );
  }

  if (input.resumeText) {
    const cleanedResume = input.resumeText
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.\n]*/gi, '')
      .replace(/[^\n.]*\b(?:prison|jail|incarcerat(?:ed|ion)?|correctional|inmate|probation|parole|sentence[ds]?|conviction[s]?|convicted|detained|lockup|behind\s+bars|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon[y]?)\b[^.\n]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    parts.push(`ORIGINAL RESUME TEXT (transform duties into CAR achievements):\n${cleanedResume.slice(0, 6000)}`);
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

  const prompt = `Write a world-class professional resume using the data below. Make it significantly better than the input.

${parts.join("\n\n")}

EXACT OUTPUT FORMAT (plain text, follow precisely):

FULL NAME
City, State | (XXX) XXX-XXXX | email@email.com

Branded headline — one powerful line. Not an objective. An identity.

CAREER SUMMARY
3-4 sentences. Position this person as a professional. What they bring, what industry they've grown through, where they're headed. NO generic filler. NO "dedicated professional" or "proven track record." Write like describing someone you're impressed by.

CORE COMPETENCIES
Term 1 | Term 2 | Term 3
Term 4 | Term 5 | Term 6
Term 7 | Term 8 | Term 9
(9-12 terms. No labels. No categories. Just the skills. Pull from ACTUAL job content.)

PROFESSIONAL EXPERIENCE

JOB TITLE | Company Name | City, State | Start Year - End Year
- Strong verb + what was done + quantified result. Every bullet has a number.
- Strong verb + achievement with scope (headcount, volume, percentage).
- 3-5 bullets per role.

(Repeat for each role, reverse chronological)

EDUCATION
Institution Name, City, State | Start Year - End Year
Relevant coursework or focus area if it adds value (only what the source states).

CERTIFICATIONS
- Cert name (year, only if the source states it)
- Cert name (year, only if the source states it)

CRITICAL REMINDERS:
- TRUTH GATE: every number, tool, certification, and result must come from the source data. If the input is bare or poorly written, make the output CLEAN and strong, never padded -- real facts, strong verbs, zero invention.
- If a job title/company pairing doesn't make sense (retail work at a printing company), repair the pairing using context. Never invent a new employer or role.
- Transform duties into achievement language using only the source's facts and stated scale.
- CERTIFICATIONS: include ONLY certifications the source states, exactly as stated. Never annotate "(Current)" unless the source says so.
- NO placeholder brackets. NO [Company Name]. Use real data or omit.
- If no work history exists: build a FUNCTIONAL resume with skill-area sections and bullets from the strengths data provided -- nothing beyond it.
- Certifications get their OWN section -- never buried in education.`;

  return await callClaude(system, prompt, 4500);
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
- TRUTH GATE: never fabricate achievements, experience, numbers, certifications, or personal facts (transportation, availability, physical capability, references). Every claim must come from the profile data provided.
- Use "--" never an em dash.`;

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
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.\n]*/gi, '')
      .replace(/[^\n.]*\b(?:prison|jail|incarcerat(?:ed|ion)?|correctional|inmate|probation|parole|sentence[ds]?|conviction[s]?|convicted|detained|lockup|behind\s+bars|reentry|re-entry|justice[- ]involved|justice[- ]impacted|felon[y]?)\b[^.\n]*/gi, '')
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
