/**
 * Full Resume Generation API
 *
 * Takes Forge data + a specific job posting and generates
 * a complete, targeted ResumeDocument ready for the editor.
 * Logged to decision_log for JBS compliance.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";

export const maxDuration = 60;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 2_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const { forgeOutput, resumeText, job, contact } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    if (!job?.title) {
      return NextResponse.json({ error: "Job title required" }, { status: 400 });
    }

    // Build context strings
    const jobTitle = sanitizeForPrompt(job.title, 200);
    const jobCompany = sanitizeForPrompt(job.company, 200);
    const jobDescription = sanitizeForPrompt(job.description, 2000);
    const jobRequirements = sanitizeArray(job.requirements, 10, 300);

    const skills = forgeOutput?.skills
      ? sanitizeArray(
          forgeOutput.skills.map((s: any) => (typeof s === "string" ? s : s.name)),
          20,
          100
        )
      : "not specified";

    const narrative = sanitizeForPrompt(forgeOutput?.narrative?.summary, 1000);
    const strengths = forgeOutput?.narrative?.strengths
      ? sanitizeArray(
          forgeOutput.narrative.strengths.map((s: any) => `${s.title}: ${s.evidence}`),
          10,
          300
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

    const prompt = `Generate a complete, targeted resume for this specific job posting. Return ONLY valid JSON matching the exact structure below.

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
  "summary": "2-3 sentence professional summary targeted specifically at ${jobTitle} at ${jobCompany}",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "startDate": "2020",
      "endDate": "",
      "bullets": ["Action verb bullet with metrics...", "Another bullet..."]
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

CRITICAL RULES:
1. Target this resume SPECIFICALLY at ${jobTitle} at ${jobCompany}
2. Match the person's real background to the job requirements
3. Use strong action verbs, include numbers/metrics where possible
4. Write at a 6th grade reading level — clear, direct, no jargon
5. Include 6-10 relevant skills that match the job posting
6. NEVER mention incarceration, criminal records, justice involvement, parole, probation, or any disqualifying information
7. NEVER fabricate experience — only use what's in the person's background
8. Each work entry needs 2-4 bullet points
9. If the person's resume has work history, preserve the real companies and dates
10. Return ONLY the JSON object, no markdown fences, no explanation`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const aiData = await response.json();
    const rawText = aiData.content[0]?.text?.trim() || "";

    // Parse JSON from AI response (handles markdown fences, etc.)
    let parsed: any;
    try {
      const { extractAndParseJSON } = await import("@crucible/core");
      parsed = extractAndParseJSON(rawText);
    } catch {
      // Fallback: try direct parse
      parsed = JSON.parse(rawText);
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

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "resume-generate-full",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: JSON.stringify({ jobTitle: job.title, jobCompany: job.company }).slice(0, 500),
        explanation: `Generated full targeted resume for ${job.title} at ${job.company}.`,
        outputSummary: {
          type: "full_resume_generation",
          experienceCount: resume.experience.length,
          skillsCount: resume.skills.length,
          summaryLength: resume.summary.length,
        },
      });
    } catch (err) {
      console.error("Decision log failed (resume-generate-full):", err);
    }

    return NextResponse.json({ resume });
  } catch (error: any) {
    console.error("Full resume generation error:", error);
    return NextResponse.json(
      { error: "Could not generate resume. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "resume-full", requiredTier: "client" });
