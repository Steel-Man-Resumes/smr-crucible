/**
 * Career Package Generation API
 *
 * Takes Forge data + a specific job posting and generates a complete package:
 * 1. Targeted resume (ResumeDocument JSON)
 * 2. Targeted cover letter (plain text, for THAT employer)
 * 3. Disclosure mini-brief (confidence rating + script based on what Forge knows)
 *
 * Logged to decision_log for JBS compliance.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { buildFullContext, userContextFromForge, type JobContext } from "@/lib/context-library";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";

export const maxDuration = 120;

async function callClaude(prompt: string, maxTokens = 2000): Promise<string> {
  return callAI("", [{ role: "user", content: prompt }], maxTokens);
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 2_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const { forgeOutput, resumeText, job, contact, challenges, criminalRecord } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    if (!job?.title) {
      return NextResponse.json({ error: "Job title required" }, { status: 400 });
    }

    // Build shared context strings
    const jobTitle = sanitizeForPrompt(job.title, 200);
    const jobCompany = sanitizeForPrompt(job.company, 200);
    const jobDescription = sanitizeForPrompt(job.description, 2000);
    const jobRequirements = sanitizeArray(job.requirements, 10, 300);

    const skills = forgeOutput?.skills
      ? sanitizeArray(
          forgeOutput.skills.map((s: any) => (typeof s === "string" ? s : s.name)),
          20, 100
        )
      : "not specified";

    const narrative = sanitizeForPrompt(forgeOutput?.narrative?.summary, 1000);
    const strengths = forgeOutput?.narrative?.strengths
      ? sanitizeArray(
          forgeOutput.narrative.strengths.map((s: any) => `${s.title}: ${s.evidence}`),
          10, 300
        )
      : "";

    const cleanedResume = resumeText
      ? sanitizeForPrompt(resumeText, 4000)
      : "not available";

    const contactName = sanitizeForPrompt(contact?.name, 100);
    const contactPhone = sanitizeForPrompt(contact?.phone, 30);
    const contactEmail = sanitizeForPrompt(contact?.email, 100);
    const contactCity = sanitizeForPrompt(contact?.city, 50);
    const contactState = sanitizeForPrompt(contact?.state, 20);

    // ─── Generate resume + cover letter in parallel ───────────────────

    // Build research-backed context
    const userCtx = userContextFromForge({ forgeOutput, resumeText, challenges, criminalRecord, readinessStage: forgeOutput?.readiness_stage });
    const jobCtx: JobContext = { targetJob: job.title, targetCompany: job.company, jobDescription: job.description, requirements: job.requirements };
    const resumeResearch = buildFullContext("resume", userCtx, jobCtx);
    const coverLetterResearch = buildFullContext("cover_letter", userCtx, jobCtx);

    const resumePrompt = `${resumeResearch}

Generate a complete, targeted resume for this specific job posting. Return ONLY valid JSON.

TARGET JOB:
- Title: ${jobTitle}
- Company: ${jobCompany}
- Description: ${jobDescription}
- Requirements: ${jobRequirements}

PERSON'S BACKGROUND:
- Original resume: ${cleanedResume}
- Narrative: ${narrative}
- Skills identified: ${skills}
${strengths ? `- Strengths: ${strengths}` : ""}

CONTACT INFO:
- Name: ${contactName}
- Phone: ${contactPhone}
- Email: ${contactEmail}
- City: ${contactCity}
- State: ${contactState}

Return this exact JSON structure:
{
  "summary": "3-4 sentence summary targeted at ${jobTitle} at ${jobCompany}. NO generic phrases. NO 'dedicated professional' or 'proven track record'. Position them as someone this employer needs.",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "startDate": "2020",
      "endDate": "",
      "bullets": ["Strong verb + achievement + number.", "Another achievement with metrics."]
    }
  ],
  "education": [
    {
      "institution": "School or Program Name",
      "credential": "Degree, Certificate, or Training",
      "year": "2020"
    }
  ],
  "skills": ["skill1", "skill2", "skill3"]
}

ABSOLUTE RULES:
1. Target this resume SPECIFICALLY at ${jobTitle} at ${jobCompany}.
2. NEVER "responsible for", "tasked with", "helped with", "assisted in". Transform every duty into an achievement.
3. NEVER these AI-flagged words: utilize, facilitate, leverage, comprehensive, streamline, dedicated, passionate, proven track record, results-driven, detail-oriented.
4. Numbers in EVERY bullet. Estimate conservatively from industry context if source has no numbers.
5. Every bullet starts with a strong action verb.
6. 3-5 bullets per role, each with measurable impact.
7. 9-12 skills that match the job posting.
8. NEVER mention incarceration, criminal records, justice involvement, parole, probation.
9. NEVER fabricate companies or job titles. But DO quantify achievements from context.
10. If a title/company pairing doesn't make sense, FIX IT.
11. Use years only (no months).
12. Return ONLY the JSON object.`;

    const coverLetterPrompt = `${coverLetterResearch}

Write a targeted cover letter for a specific job application. Plain text only, no JSON.

APPLICANT: ${contactName} from ${contactCity}, ${contactState}
TARGET: ${jobTitle} at ${jobCompany}
JOB DESCRIPTION: ${jobDescription}
REQUIREMENTS: ${jobRequirements}
BACKGROUND: ${narrative}
KEY SKILLS: ${skills}
${strengths ? `STRENGTHS: ${strengths}` : ""}

RULES:
- Address to the SPECIFIC company (${jobCompany}). NO [Company Name] placeholders. NO [Hiring Manager] — use "Dear Hiring Team" if unknown.
- 250-350 words.
- Opening: who they are, what role, why this company specifically.
- Middle: 2-3 specific achievements that match the job requirements. Include numbers.
- Close: enthusiasm, availability, confidence.
- NEVER mention incarceration, criminal records, justice involvement. Not even obliquely.
- NEVER "responsible for", "proven track record", "dedicated professional", "utilize", "leverage", "passionate".
- Write like a confident human, not an AI. No buzzwords.
- Sign with the applicant's name.

FORMAT:
Dear Hiring Team,

[body paragraphs]

Sincerely,
${contactName || "Candidate"}`;

    // Run resume + cover letter in parallel
    const [resumeRaw, coverLetterText] = await Promise.all([
      callClaude(resumePrompt, 2000),
      callClaude(coverLetterPrompt, 1500),
    ]);

    // Parse resume JSON
    let parsed: any;
    try {
      const { extractAndParseJSON } = await import("@crucible/core");
      parsed = extractAndParseJSON(resumeRaw);
    } catch {
      parsed = JSON.parse(resumeRaw);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("AI returned invalid resume structure");
    }

    // Build the full ResumeDocument
    const resume = {
      formatVersion: 2,
      meta: {
        targetJob: job.title || "",
        targetCompany: job.company || "",
        jobListingUrl: "",
        createdFrom: "forge" as const,
      },
      contact: {
        name: contact?.name || "",
        phone: contact?.phone || "",
        email: contact?.email || "",
        city: contact?.city || "",
        state: contact?.state || "",
      },
      summary: parsed.summary || "",
      experience: (parsed.experience || []).map((e: any) => ({
        id: crypto.randomUUID(),
        title: e.title || "",
        company: e.company || "",
        startDate: e.startDate || "",
        endDate: e.endDate || "",
        bullets: Array.isArray(e.bullets) ? e.bullets.filter(Boolean) : [],
      })),
      education: (parsed.education || []).map((e: any) => ({
        id: crypto.randomUUID(),
        institution: e.institution || "",
        credential: e.credential || "",
        year: e.year || "",
      })),
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter(Boolean) : [],
    };

    // ─── Build disclosure mini-brief from Forge data (no AI call) ────

    const hasRecord = (challenges || []).includes("criminal_record");
    const record = criminalRecord || {};
    let confidenceLevel: "low" | "medium" | "high" = "low";
    let confidencePercent = 15;
    let briefScript: string | null = null;
    let timingAdvice: string | null = null;
    let upgradeMessage = "";

    if (hasRecord) {
      const hasType = !!record.type;
      const hasRecency = !!record.most_recent;
      const hasSupervision = !!record.supervision;
      const hasState = !!record.state;

      // Calculate confidence
      const factors = [hasType, hasRecency, hasSupervision, hasState].filter(Boolean).length;

      if (factors >= 3) {
        confidenceLevel = "high";
        confidencePercent = 75;
        const recencyText = record.most_recent === "<1 year" ? "recently"
          : record.most_recent === "1-3 years" ? "a couple years ago"
          : record.most_recent === "3-5 years" ? "several years ago"
          : "some time ago";
        briefScript = `I want to be upfront with you — I have a ${record.type || "conviction"} on my record from ${recencyText}. ${record.supervision === "completed" ? "I've completed all supervision requirements. " : ""}Since then, I've been focused on building my career in ${jobTitle.toLowerCase()}, and I'm ready to show what I bring to ${jobCompany}.`;
        timingAdvice = `For ${jobTitle} roles, disclose after they've seen your qualifications — ideally during or just after the first interview, not on the application.`;
        upgradeMessage = "Strong starting point. The full Disclosure Planner will prepare you for follow-up questions, identify legal protections in your state, and let you practice the conversation.";
      } else if (factors >= 1) {
        confidenceLevel = "medium";
        confidencePercent = 45;
        briefScript = `I want to be transparent — I have a ${record.type || "record"} in my background. Since then, I've been building skills and experience, and I'm committed to contributing to ${jobCompany}.`;
        timingAdvice = "Disclose in person during the interview, never on paper. The Disclosure Planner can help you nail the timing.";
        upgradeMessage = "Good start, but we can do better. The full Disclosure Planner will craft a strategy specific to this employer, including what they're likely thinking and how to handle follow-ups.";
      } else {
        confidencePercent = 15;
        briefScript = null;
        timingAdvice = null;
        upgradeMessage = "We know you have a record but need more details to prepare a disclosure strategy. The Disclosure Planner will walk you through it safely and privately.";
      }
    }

    const disclosureBrief = {
      hasRecord,
      confidenceLevel,
      confidencePercent,
      briefScript,
      timingAdvice,
      upgradeMessage,
      targetJob: job.title,
      targetCompany: job.company,
    };

    // ─── Log decision ─────────────────────────────────────────────────

    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "career-package-generate",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: JSON.stringify({ jobTitle: job.title, jobCompany: job.company }).slice(0, 500),
        explanation: `Generated career package (resume + cover letter + disclosure brief) for ${job.title} at ${job.company}.`,
        outputSummary: {
          type: "career_package",
          resumeExperienceCount: resume.experience.length,
          resumeSkillsCount: resume.skills.length,
          coverLetterLength: coverLetterText.length,
          disclosureConfidence: confidenceLevel,
        },
      });
    } catch (err) {
      console.error("Decision log failed (career-package):", err);
    }

    return NextResponse.json({ resume, coverLetter: coverLetterText, disclosureBrief });
  } catch (error: any) {
    console.error("Career package generation error:", error);
    return NextResponse.json(
      { error: "Could not generate career package. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "resume-full", requiredTier: "client" });
