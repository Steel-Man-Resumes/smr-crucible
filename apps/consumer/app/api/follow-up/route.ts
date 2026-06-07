/**
 * Follow-up Generator API
 *
 * Drafts a short, professional follow-up message for a saved job application,
 * using the application's details (role, company, how long since applied) and the
 * candidate's strengths. Closes the Stage 6 loop: when a follow-up comes due, the
 * user can generate a message to send. Saves a `follow_up` artifact to the vault.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { isMockEnabled, MOCK_FOLLOW_UP } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";

export const maxDuration = 30;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24)));
}

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

  const { getOne, createArtifact } = await import("@crucible/core");

  // Load the application -- ownership-checked (authoritative source for job facts).
  const app = await getOne<{
    id: string;
    job_title: string;
    company: string;
    status: string;
    applied_at: string | null;
    notes: string | null;
  }>(
    `SELECT id, job_title, company, status, applied_at, notes
       FROM job_application WHERE id = $1 AND user_id = $2`,
    [applicationId, session.user.id]
  );
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (isMockEnabled()) {
    return NextResponse.json(MOCK_FOLLOW_UP);
  }

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }

  const days = daysSince(app.applied_at);
  const strengths: string[] = Array.isArray(forgeContext?.strengths)
    ? forgeContext.strengths.map((s: any) => (typeof s === "string" ? s : s?.title)).filter(Boolean)
    : [];

  const candidateBlock = strengths.length
    ? `\nThe candidate's key strengths to reference briefly: ${sanitizeArray(strengths)}`
    : "";

  const prompt = `You are helping a job seeker write a short follow-up message after applying for a job.

THE APPLICATION:
- Role: ${sanitizeForPrompt(app.job_title)}
- Company: ${sanitizeForPrompt(app.company)}
- Current status: ${sanitizeForPrompt(app.status, 50)}
${days !== null ? `- Applied about ${days} day(s) ago` : ""}${app.notes ? `\n- Their notes: ${sanitizeForPrompt(app.notes, 400)}` : ""}${candidateBlock}

Write a brief, professional, warm follow-up email. Reiterate genuine interest, reference one relevant strength if provided, and politely ask about next steps. Do NOT mention any criminal record. Keep it under 120 words.

Return JSON only:
{ "subject": "a short subject line", "body": "the email body, with line breaks as \\n" }`;

  try {
    const text = await callAI("", [{ role: "user", content: prompt }], 600);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let result: { subject: string; body: string };
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          subject: typeof parsed.subject === "string" ? parsed.subject : `Following up -- ${app.job_title}`,
          body: typeof parsed.body === "string" ? parsed.body : text.trim(),
        };
      } catch {
        result = { subject: `Following up -- ${app.job_title}`, body: text.trim() };
      }
    } else {
      result = { subject: `Following up -- ${app.job_title}`, body: text.trim() };
    }

    // Save to the vault as a follow_up artifact (not a journey gate).
    try {
      await createArtifact(
        session.user.id,
        "follow_up",
        { applicationId: app.id, targetJob: app.job_title, targetCompany: app.company },
        { ...result, targetJob: app.job_title, targetCompany: app.company, createdAt: new Date().toISOString() }
      );
    } catch (e: any) {
      console.error("Follow-up artifact save failed:", e?.message || e);
    }

    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "follow-up",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: `${app.job_title} @ ${app.company} (${app.status})`.slice(0, 500),
        explanation: `Drafted a follow-up message for a ${app.status} application.`,
        outputSummary: { type: "follow_up", status: app.status, days_since_applied: days },
      });
    } catch (err) {
      console.error("Decision log failed (follow-up):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Follow-up generation error:", error);
    return NextResponse.json({ error: "Could not draft a follow-up" }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "follow-up", requiredTier: "client" });
