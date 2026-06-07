/**
 * Interview Voice Token API
 *
 * Mints short-lived OpenAI Realtime client secrets for authenticated
 * browser-based voice practice. The standard OpenAI API key never reaches
 * the browser.
 */

import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeArray, sanitizeForPrompt } from "@/lib/sanitize";

export const maxDuration = 15;

const REALTIME_MODEL = "gpt-realtime-2";
const MAX_REQUEST_BYTES = 100_000;

interface VoiceSessionBody {
  config?: {
    targetRole?: string;
    interviewType?: string;
    includeDisclosure?: boolean;
  };
  forgeContext?: {
    skills?: string[];
    strengths?: string[];
    narrative?: string;
  };
}

function buildVoiceInstructions(body: VoiceSessionBody): string {
  const config = body.config || {};
  const forge = body.forgeContext || {};
  const targetRole = sanitizeForPrompt(config.targetRole, 120);
  const interviewType = sanitizeForPrompt(config.interviewType, 80);
  const skills = sanitizeArray(forge.skills, 10, 80);
  const strengths = sanitizeArray(forge.strengths, 6, 120);
  const narrative = sanitizeForPrompt(forge.narrative, 700);
  const includeDisclosure =
    config.includeDisclosure || config.interviewType === "disclosure";

  return `You are a professional hiring manager running a live voice mock interview.

Target role: ${targetRole}
Interview type: ${interviewType}
Candidate skills: ${skills}
Candidate strengths: ${strengths}
Candidate context: ${narrative}

Rules:
- Start immediately with a short greeting and one interview question.
- Ask one question at a time.
- Keep spoken turns short: 1-3 sentences.
- Use natural follow-up questions based on the user's answer.
- Be fair, direct, and realistic. Do not flatter.
- After about 5 candidate answers, end the practice and give concise feedback.
- Feedback should cover clarity, confidence, specificity, and next improvement.
- Do not promise hiring outcomes or give legal advice.
${
  includeDisclosure
    ? "- Around the third or fourth answer, ask professionally about background-check context so the user can practice disclosure."
    : "- Do not ask for criminal record details unless the user raises it first."
}`;
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Voice practice is not configured" },
      { status: 500 }
    );
  }

  let body: VoiceSessionBody = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const safetyIdentifier = crypto
    .createHash("sha256")
    .update(userId)
    .digest("hex");

  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: buildVoiceInstructions(body),
          reasoning: { effort: "low" },
          audio: {
            output: {
              voice: "marin",
            },
          },
        },
      }),
    }
  );

  const text = await response.text();
  if (!response.ok) {
    console.error("Realtime token error:", response.status, text.slice(0, 500));
    return NextResponse.json(
      { error: "Could not start voice practice" },
      { status: response.status }
    );
  }

  try {
    const { logDecision } = await import("@crucible/core");
    await logDecision({
      userId,
      contextPage: "interview-voice",
      modelProvider: "openai",
      modelId: REALTIME_MODEL,
      input: JSON.stringify({
        targetRole: body.config?.targetRole,
        interviewType: body.config?.interviewType,
        includeDisclosure: body.config?.includeDisclosure,
      }).slice(0, 500),
      explanation:
        "Minted authenticated OpenAI Realtime client secret for live interview practice.",
      outputSummary: {
        type: "interview_voice_token",
        model: REALTIME_MODEL,
      },
    });
  } catch (err) {
    console.error("Decision log failed (interview voice):", err);
  }

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "interview",
  requiredTier: "client",
});
