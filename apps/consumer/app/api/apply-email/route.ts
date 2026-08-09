/**
 * Apply-Email Generator API (Wave R / R8, rung 3)
 *
 * The last rung of the Apply ladder: when a saved job has no direct apply link
 * and no employer website, t.ROY helps the user apply by EMAIL. It drafts a
 * short, professional application email built from the job + the candidate's
 * real strengths, and coaches them on where to find the employer's careers/HR
 * address. Draft-only -- nothing is ever sent for the user, and we never guess
 * or invent an email address.
 *
 * Modeled on /api/follow-up: ownership-checked application load, mock-aware,
 * rate-limited (client tier), decision-logged.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { isMockEnabled } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";

export const maxDuration = 30;

const MOCK_APPLY_EMAIL = {
  subject: "Application for Warehouse Associate -- Jordan Williams",
  body:
    "Dear Hiring Manager,\n\nI am applying for the Warehouse Associate role. I bring five years of reliable warehouse and forklift experience, a strong safety record, and a track record of showing up and getting the work done. My resume is attached.\n\nI would welcome the chance to talk about how I can contribute to your team. Thank you for your time and consideration.\n\nSincerely,\nJordan Williams",
  whereToFind:
    "Look for a \"Careers\" or \"Contact\" link on the company's website -- application emails often go to careers@ or hr@ their domain. If you only find a general info@ address, that is fine; ask them to forward it to hiring. You can also call the main number and ask who receives job applications.",
};

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { applicationId, forgeContext } = await request.json();
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const { getOne } = await import("@crucible/core");

  // Load the application -- ownership-checked (authoritative source for job facts).
  const app = await getOne<{
    id: string;
    job_title: string;
    company: string;
    location: string | null;
  }>(
    `SELECT id, job_title, company, location
       FROM job_application WHERE id = $1 AND user_id = $2`,
    [applicationId, session.user.id]
  );
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (isMockEnabled()) {
    return NextResponse.json(MOCK_APPLY_EMAIL);
  }

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }

  const strengths: string[] = Array.isArray(forgeContext?.strengths)
    ? forgeContext.strengths.map((s: any) => (typeof s === "string" ? s : s?.title)).filter(Boolean)
    : [];
  const candidateName: string =
    typeof forgeContext?.name === "string" ? forgeContext.name.trim() : "";

  const candidateBlock = strengths.length
    ? `\nThe candidate's key strengths to reference briefly (only what is true): ${sanitizeArray(strengths)}`
    : "";
  const nameBlock = candidateName
    ? `\nSign the email as: ${sanitizeForPrompt(candidateName, 80)}`
    : "";

  const prompt = `You are t.ROY, helping a justice-impacted job seeker apply for a job by EMAIL because the employer offers no online application link.

THE JOB:
- Role: ${sanitizeForPrompt(app.job_title)}
- Company: ${sanitizeForPrompt(app.company)}${app.location ? `\n- Location: ${sanitizeForPrompt(app.location, 120)}` : ""}${candidateBlock}${nameBlock}

Write a short, professional, warm application email the candidate can send with their resume and cover letter. Reference one relevant strength if provided. Assume the resume is attached. Keep it under 130 words. Do NOT mention any criminal record. Do NOT invent an email address, hiring manager name, or facts about the candidate.

Also write a brief, practical "where to find the address" tip (2-3 sentences) coaching them how to find the employer's careers/HR email -- check the company website's Careers/Contact page, common patterns like careers@ or hr@, or call and ask who receives applications. Never fabricate a specific address.

Return JSON only:
{ "subject": "a short subject line naming the role", "body": "the email body, with line breaks as \\n", "whereToFind": "the address-finding tip" }`;

  try {
    const text = await callAI("", [{ role: "user", content: prompt }], 700, undefined, {
      endpoint: "apply-email",
      userId: session.user.id,
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const fallbackSubject = `Application for ${app.job_title} -- ${app.company}`;
    let result: { subject: string; body: string; whereToFind: string };
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          subject: typeof parsed.subject === "string" ? parsed.subject : fallbackSubject,
          body: typeof parsed.body === "string" ? parsed.body : text.trim(),
          whereToFind:
            typeof parsed.whereToFind === "string" ? parsed.whereToFind : MOCK_APPLY_EMAIL.whereToFind,
        };
      } catch {
        result = { subject: fallbackSubject, body: text.trim(), whereToFind: MOCK_APPLY_EMAIL.whereToFind };
      }
    } else {
      result = { subject: fallbackSubject, body: text.trim(), whereToFind: MOCK_APPLY_EMAIL.whereToFind };
    }

    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "apply-email",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: `${app.job_title} @ ${app.company}`.slice(0, 500),
        explanation: "Drafted an application email for a job with no online apply link.",
        outputSummary: { type: "apply_email", company: app.company },
      });
    } catch (err) {
      console.error("Decision log failed (apply-email):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Apply-email generation error:", error);
    return NextResponse.json({ error: "Could not draft an application email" }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "apply-email", requiredTier: "client" });
