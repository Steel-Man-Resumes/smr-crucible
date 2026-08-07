/**
 * Interview Practice API
 *
 * Conducts mock interviews with AI.
 * After 5-6 exchanges, provides structured feedback.
 * Adapts to role, interview type, and disclosure needs.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { buildFullContext, type UserContext } from "@/lib/context-library";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    // Route is mode:"user" in withRateLimit, so a session is guaranteed by
    // the time handlePost runs -- re-derive here to attribute the AI call.
    const session = await auth();
    const userId = session?.user?.id;

    const { messages, config, exchangeCount, forgeContext, resume, jobDescription, endInterview } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    const isDisclosure =
      config.interviewType === "disclosure" || config.includeDisclosure;
    // Wrap up (feedback scorecard) either after enough exchanges, OR when the user
    // clicks "End" with at least one real answer on the board (F13 -- ending must
    // never dump them back to setup empty-handed).
    const shouldWrapUp = exchangeCount >= 5 || endInterview === true;

    // Build candidate context from Forge data
    let candidateBlock = "";
    if (forgeContext) {
      const parts: string[] = [];
      if (forgeContext.narrative) parts.push(`About the candidate: ${sanitizeForPrompt(forgeContext.narrative, 1000)}`);
      if (forgeContext.strengths?.length) parts.push(`Their key strengths: ${sanitizeArray(forgeContext.strengths)}`);
      if (forgeContext.skills?.length) parts.push(`Their skills: ${sanitizeArray(forgeContext.skills)}`);
      if (parts.length) {
        candidateBlock = `\n\nCANDIDATE PROFILE (use this to ask relevant follow-up questions):\n${parts.join("\n")}`;
      }
    }

    // Phase 3: questions off the REAL application -- the specific tailored resume
    // and (optionally) the actual job posting, not just generic Forge context.
    let applicationBlock = "";
    if (resume?.text) {
      const jobLabel = [resume.targetJob, resume.targetCompany].filter(Boolean).join(" at ");
      applicationBlock += `\n\nTHE CANDIDATE'S ACTUAL RESUME${jobLabel ? ` (tailored for ${sanitizeForPrompt(jobLabel, 160)})` : ""} -- ask about THIS real experience by name (specific jobs, tools, results), not hypotheticals:\n${sanitizeForPrompt(resume.text, 2800)}`;
    }
    // Interview handoff (Phase 7.5): the bullet-workshop proof behind their
    // bullets. Probe these for depth and build model answers from them.
    if (Array.isArray(resume?.evidence) && resume.evidence.length) {
      const proof = resume.evidence
        .slice(0, 12)
        .map((p: any) => {
          const facts = [
            p.did && `did: ${sanitizeForPrompt(p.did, 200)}`,
            p.tools && `tools: ${sanitizeForPrompt(p.tools, 160)}`,
            p.often && `how often: ${sanitizeForPrompt(p.often, 100)}`,
            p.quantity && `how many: ${sanitizeForPrompt(p.quantity, 100)}`,
            p.improved && `what improved: ${sanitizeForPrompt(p.improved, 200)}`,
          ]
            .filter(Boolean)
            .join("; ");
          const head = sanitizeForPrompt(p.bullet || p.role || "", 180);
          return facts ? `- ${head} (${facts})` : `- ${head}`;
        })
        .filter((l: string) => l.trim().length > 3)
        .join("\n");
      if (proof) {
        applicationBlock += `\n\nPROOF BEHIND THEIR BULLETS -- the concrete facts they gave for each accomplishment. Probe these for depth ("you said you trained 3 new hires -- walk me through that"), and build model answers from them. Never invent beyond these facts:\n${proof}`;
      }
    }
    if (typeof jobDescription === "string" && jobDescription.trim()) {
      applicationBlock += `\n\nTHE JOB POSTING THEY ARE APPLYING TO -- tailor your questions to THESE specific requirements:\n${sanitizeForPrompt(jobDescription, 2000)}`;
    }

    const sanitizedTargetRole = sanitizeForPrompt(config.targetRole);
    const sanitizedInterviewType = sanitizeForPrompt(config.interviewType, 100);

    // Build research-backed context
    const interviewUserCtx: UserContext = {
      strengths: forgeContext?.strengths?.map((s: string) => ({ title: s, evidence: "" })) || [],
      skills: forgeContext?.skills?.map((s: string) => ({ name: s })) || [],
      narrative: forgeContext?.narrative || undefined,
    };
    const interviewResearch = buildFullContext("interview", interviewUserCtx, { targetJob: config.targetRole });

    let systemPrompt = `${interviewResearch}

You are a hiring manager conducting a job interview${config.targetRole ? ` for a ${sanitizedTargetRole} position` : ""}.

INTERVIEW STYLE: ${sanitizedInterviewType}
${config.interviewType === "behavioral" ? "Ask STAR-method questions (Situation, Task, Action, Result). Press for specifics." : ""}
${config.interviewType === "industry" ? `Ask questions specific to the ${sanitizedTargetRole || "target"} field. Include technical and situational questions.` : ""}

YOUR ROLE:
- Be professional, warm, and realistic
- Ask one question at a time
- React naturally to their answers — acknowledge what they said before moving on
- Don't be hostile, but don't be a pushover. Ask follow-ups a real interviewer would.
- Keep your responses to 2-3 sentences max
${candidateBlock}${applicationBlock}
${isDisclosure ? `DISCLOSURE ELEMENT:
- At some point during the interview (around exchange 3-4), naturally bring up background checks
- Say something like "We do run a background check as part of our process. Is there anything you'd like to share about that?"
- React professionally to their disclosure — not too positive, not negative. Just professional.` : ""}`;

    if (shouldWrapUp) {
      // Generate feedback instead of continuing
      systemPrompt = `You were conducting a mock job interview${config.targetRole ? ` for a ${sanitizedTargetRole} position` : ""}.
${isDisclosure ? "The interview included a criminal record disclosure element." : ""}
${candidateBlock}${applicationBlock}

The interview is now over. Review the entire conversation and provide:
1. A brief closing statement as the interviewer (1-2 sentences)
2. Then break character and provide structured feedback.

Return JSON:
{
  "closing": "Your closing statement as the interviewer",
  "feedback": {
    "strengths": ["2-3 specific things they did well"],
    "improvements": ["2-3 specific things to work on"],
    "overall": "1-2 sentence overall assessment. Encouraging but honest.",
    "better_answers": [
      { "question": "a real question from this interview they could have answered more strongly", "model_answer": "a stronger model answer, 2-4 sentences, built from THEIR real experience (use the resume) -- show, do not tell" }
    ],
    "frame": "1-2 sentences: the single posture or through-line to carry into the real interview for this role.",
    ${isDisclosure ? '"disclosure_notes": "How they handled the disclosure moment specifically. What worked, what to adjust."' : '"disclosure_notes": null'}
  }
}

RULES:
- Be specific — reference actual things they said
- Focus on communication skills: confidence, clarity, brevity, pivot to strengths
- ACCOUNTABILITY CHECK (do not skip): if any answer shifted blame, minimized their role, or framed their record as something that was done TO them ("it wasn't really my fault," "they charged me with," "the system"), you MUST name it plainly in improvements -- kindly, not as a lecture -- and in better_answers model the SAME point rewritten with ownership (what they did, what they learned, who they are now). Employers, and especially peer-support and reentry roles, hire for ownership; a polished answer that dodges it still fails the interview. If they owned their story well, say so in strengths.
- For better_answers, model 1-2 stronger responses built from their real resume, in their own voice -- show them what good sounds like
- 6th grade reading level
- JSON only (after the closing statement)`;
    }

    const chatMessages = messages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const text = await callAI(systemPrompt, chatMessages, shouldWrapUp ? 1800 : 300, shouldWrapUp ? MODEL_DEEP : undefined, { userId, endpoint: "interview-practice" });

    if (shouldWrapUp) {
      // Log wrapup decision
      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          contextPage: "interview-practice",
          modelProvider: AI_PROVIDER,
          modelId: AI_MODEL,
          input: (messages[messages.length - 1]?.content || "").slice(0, 500),
          explanation: `Interview practice feedback wrapup. Type: ${config.interviewType}. Role: ${config.targetRole || "general"}. ${exchangeCount} exchanges.`,
          outputSummary: {
            type: "interview_feedback",
            exchange_count: exchangeCount,
            interview_type: config.interviewType,
            is_wrapup: true,
          },
        });
      } catch (err) {
        console.error("Decision log failed (interview wrapup):", err);
      }

      // Parse feedback from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return NextResponse.json({
            response:
              parsed.closing || "Thank you for your time today. We'll be in touch.",
            feedback: parsed.feedback,
          });
        } catch {
          // If JSON parse fails, return the text as closing with generic feedback
          return NextResponse.json({
            response: text.split("{")[0].trim() || "Thank you for your time today.",
            feedback: {
              strengths: ["You completed the full practice interview"],
              improvements: [
                "Try to be more specific in your answers",
                "Practice pivoting to your strengths",
              ],
              overall:
                "Good effort completing the practice. The more you practice, the more natural it feels.",
            },
          });
        }
      }
      return NextResponse.json({
        response: text,
        feedback: {
          strengths: ["You showed up and practiced — that takes courage"],
          improvements: ["Keep practicing to build confidence"],
          overall: "Every practice session makes the real thing easier.",
        },
      });
    }

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "interview-practice",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: (messages[messages.length - 1]?.content || "").slice(0, 500),
        explanation: `Interview practice exchange #${exchangeCount}. Type: ${config.interviewType}. Role: ${config.targetRole || "general"}.`,
        outputSummary: {
          type: "interview_exchange",
          exchange_count: exchangeCount,
          interview_type: config.interviewType,
          is_wrapup: false,
        },
      });
    } catch (err) {
      console.error("Decision log failed (interview):", err);
    }

    return NextResponse.json({ response: text });
  } catch (error: any) {
    console.error("Interview practice error:", error);
    return NextResponse.json(
      { error: "Could not process interview" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "interview", requiredTier: "client" });
