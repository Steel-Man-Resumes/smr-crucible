import { loadVoiceWork } from "@/lib/voice-work-context";
import { loadApplicationContext } from "@/lib/application-context";
import { formatResumeDownload } from "@/components/resume/resumeModel";
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
import { checkTextPracticeAllowance } from "@/lib/premium-server";
import { refundUserUsage } from "@crucible/core";
import { sanitizeForPrompt, sanitizeArray, sanitizeOrEmpty } from "@/lib/sanitize";
import { buildFullContext, type UserContext } from "@/lib/context-library";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { plainPunctuation, logDashSwaps } from "@/lib/legal-sanitize";
import { verifyGrounding } from "@/lib/grounding-verify";
import { interviewFeedbackMessages, parseInterviewFeedback, screenInterviewExamples } from "@/lib/interview-feedback";

export const maxDuration = 60;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // Declared outside the try so a failed AI call can still hand back the id
  // of a session it already counted (review r2, I-b).
  let practiceSession: string | undefined;
  try {
    // Route is mode:"user" in withRateLimit, so a session is guaranteed by
    // the time handlePost runs -- re-derive here to attribute the AI call.
    const session = await auth();
    const userId = session?.user?.id;

    const body = await request.json();
    const { messages, config, exchangeCount, forgeContext, endInterview } = body;
    let { resume, jobDescription } = body;
    if (body.voiceContext === true) {
      if (!userId) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
      let selected;
      try { selected = await loadVoiceWork(userId, body); }
      catch { return NextResponse.json({ error: "The selected job or resume could not be loaded. Your answers remain in this tab." }, { status: 409 }); }
      jobDescription = selected.work.jobDescription;
      resume = selected.work.resumeText ? { text: selected.work.resumeText, evidence: [] } : undefined;
      if (config) config.targetRole = selected.body.config?.targetRole;
    } else if (typeof body.applicationId === "string" && body.applicationId) {
      if (!userId) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
      const selected = await loadApplicationContext(userId, body.applicationId);
      if (!selected) return NextResponse.json({ error: "That saved job is unavailable in your account" }, { status: 404 });
      jobDescription = selected.application.jd_full_text || selected.application.jd_excerpt || selected.application.description || "";
      let resumeText = selected.resumeSnapshot ? formatResumeDownload(selected.resumeSnapshot.content_snapshot as any) : selected.revision?.resume_text || "";
      if (body.resumeArtifactId && body.resumeArtifactId !== selected.application.resume_artifact_id) {
        const core = await import("@crucible/core");
        const changed = await core.getLatestRevision(userId, body.resumeArtifactId);
        if (!changed) return NextResponse.json({ error: "That resume is unavailable in your account" }, { status: 404 });
        resumeText = changed.resume_text;
      }
      resume = resumeText ? { text: resumeText, targetJob: selected.application.job_title, targetCompany: selected.application.company, evidence: [] } : undefined;
      if (config) config.targetRole = [selected.application.job_title, selected.application.company].filter(Boolean).join(" at ");
    }
    if (!config || typeof config.interviewType !== "string" || !Array.isArray(messages) || !messages.length || messages.some((m: any) => !m || typeof m.content !== "string")) {
      return NextResponse.json({ error: "Choose an interview and add your answer before continuing." }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    // Text practice is free with an account (the premium split, Troy
    // 2026-10-10), up to a daily number of sessions while the gate is on.
    // A sponsor removes the allowance. Counted once per practice interview.
    // A server-issued session id decides what counts as a new session (review
    // L1). A refused turn gives back the daily AI call it was charged (I2).
    if (userId) {
      const verdict = await checkTextPracticeAllowance(userId, body);
      if (verdict.refuse) {
        await refundUserUsage(userId, "interview").catch(() => {});
        return verdict.refuse;
      }
      practiceSession = verdict.session;
    }
    const reply = (payload: unknown) =>
      NextResponse.json(practiceSession ? { ...(payload as Record<string, unknown>), practiceSession } : payload);

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
      applicationBlock += `\n\nTHE CANDIDATE'S ACTUAL RESUME${jobLabel ? ` (tailored for ${sanitizeForPrompt(jobLabel, 160)})` : ""}. Ask about THIS real experience by name (specific jobs, tools, results), not hypotheticals:\n${sanitizeForPrompt(resume.text, 2800)}`;
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
          // "" when there is no bullet or role, so an entry with no facts is
          // dropped below instead of becoming "- not specified".
          const head = sanitizeOrEmpty(p.bullet || p.role, 180);
          return facts
            ? `- ${head || "(accomplishment not named)"} (${facts})`
            : head
              ? `- ${head}`
              : "";
        })
        .filter((l: string) => l.trim().length > 3)
        .join("\n");
      if (proof) {
        applicationBlock += `\n\nPROOF BEHIND THEIR BULLETS: the concrete facts they gave for each accomplishment. Probe these for depth ("You said you trained 3 new hires. Walk me through that."), and build model answers from them. Never invent beyond these facts:\n${proof}`;
      }
    }
    if (typeof jobDescription === "string" && jobDescription.trim()) {
      applicationBlock += `\n\nTHE JOB POSTING THEY ARE APPLYING TO. Tailor your questions to THESE specific requirements:\n${sanitizeForPrompt(jobDescription, 2000)}`;
    }

    // "" for a blank role, so the role fallbacks in the prompts below fire.
    const sanitizedTargetRole = sanitizeOrEmpty(config.targetRole);
    const sanitizedInterviewType = sanitizeForPrompt(config.interviewType, 100);

    // Phase 5.9 progressive practice: skills the user chose to target this run,
    // carried over from last session's feedback. Encouraging framing only.
    const focusAreas: string[] = Array.isArray(config?.focusAreas)
      ? config.focusAreas
          .filter((f: unknown): f is string => typeof f === "string" && f.trim().length > 0)
          .slice(0, 4)
          .map((f: string) => sanitizeForPrompt(f, 60))
      : [];
    const focusBlock = focusAreas.length
      ? `\n\nWHAT THE CANDIDATE IS WORKING ON THIS SESSION: ${focusAreas.join(", ")}. Give them natural chances to practice these skills, and notice out loud when they do it well. Frame it as building a strength, never as a weakness.`
      : "";

    // Build research-backed context
    const interviewUserCtx: UserContext = {
      strengths: forgeContext?.strengths?.map((s: string) => ({ title: s, evidence: "" })) || [],
      skills: forgeContext?.skills?.map((s: string) => ({ name: s })) || [],
      narrative: forgeContext?.narrative || undefined,
    };
    const interviewResearch = buildFullContext("interview", interviewUserCtx, { targetJob: config.targetRole });

    let systemPrompt = `${interviewResearch}

You are a hiring manager conducting a job interview${sanitizedTargetRole ? ` for a ${sanitizedTargetRole} position` : ""}.

INTERVIEW STYLE: ${sanitizedInterviewType}
${config.interviewType === "behavioral" ? "Ask STAR-method questions (Situation, Task, Action, Result). Press for specifics." : ""}
${config.interviewType === "industry" ? `Ask questions specific to the ${sanitizedTargetRole || "target"} field. Include technical and situational questions.` : ""}

YOUR ROLE:
- Be professional, warm, and realistic
- Ask one question at a time
- React naturally to their answers. Acknowledge what they said before moving on
- Don't be hostile, but don't be a pushover. Ask follow-ups a real interviewer would.
- Keep your responses to 2-3 sentences max
- Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence. No contrast sentences: never write "not X, but Y", "X, not Y", "X, not just Y", "more than just X" or "you're not X, you're Y". Say the positive point directly. Hyphens inside words (no-cost, part-time) are fine.
${candidateBlock}${applicationBlock}${focusBlock}
${isDisclosure ? `DISCLOSURE ELEMENT:
- At some point during the interview (around exchange 3-4), naturally bring up background checks
- Say something like "We do run a background check as part of our process. Is there anything you'd like to share about that?"
- React professionally to their disclosure. Not too positive, not negative. Just professional.` : ""}`;

    if (shouldWrapUp) {
      // Generate feedback instead of continuing
      systemPrompt = `You were conducting a mock job interview${sanitizedTargetRole ? ` for a ${sanitizedTargetRole} position` : ""}.
${isDisclosure ? "The interview included a criminal record disclosure element." : ""}
${candidateBlock}${applicationBlock}

The interview is now over. Review the entire conversation and provide:
1. A brief closing statement as the interviewer (1-2 sentences) inside the JSON closing field.
2. Then break character and provide structured feedback inside the same JSON object. Do not ask another interview question.

Return JSON:
{
  "closing": "Your closing statement as the interviewer",
  "feedback": {
    "strengths": ["Specific things this practice actually shows; fewer are fine when evidence is limited"],
    "improvements": ["Specific next practice steps supported by this conversation"],
    "overall": "1-2 sentence overall assessment. Encouraging but honest.",
    "better_answers": [
      { "question": "a real question from this interview they could have answered more strongly", "model_answer": "a stronger model answer, 2-4 sentences, built from THEIR real experience (use the resume). Show, do not tell." }
    ],
    "frame": "1-2 sentences: the single posture or through-line to carry into the real interview for this role.",
    ${isDisclosure ? '"disclosure_notes": "How they handled the disclosure moment specifically. What worked, what to adjust."' : '"disclosure_notes": null'}
  }
}

RULES:
- Be specific. Reference actual things they said
- Focus on communication skills: confidence, clarity, brevity, pivot to strengths
- ACCOUNTABILITY CHECK: when the candidate has acknowledged their own conduct, help them explain their role plainly. Ask for missing details about what they did or learned; never supply them. A phrase such as "they charged me with" alone does not establish blame shifting. Never turn a disputed or unknown event into an admission. Do not score choosing not to disclose as failure. Comment only on what this practice actually shows.
- For better_answers, model 1-2 stronger responses built from their real resume, in their own voice. Show them what good sounds like
- Use only facts the candidate supplied in the transcript or resume. The job posting describes the employer's needs, not the candidate's experience. Never add tools, duties, frequency, numbers, results, feelings, motives or lessons they did not give. Respect explicit negatives, such as never operating a forklift. If a specific story or result is missing, ask for that detail in improvements and keep better_answers empty when a stronger answer would require inventing it. A short practice only supports limited feedback; say so.
- 6th grade reading level. Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence. No contrast sentences: never write "not X, but Y", "X, not Y", "X, not just Y", "more than just X" or "you're not X, you're Y". Say the positive point directly. Hyphens inside words (no-cost, part-time) are fine. No emojis.
- Return only one valid JSON object, including the closing field. No text before or after it.`;
    }

    const chatMessages = messages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const text = await callAI(systemPrompt, shouldWrapUp ? interviewFeedbackMessages(chatMessages) : chatMessages, shouldWrapUp ? 1800 : 300, shouldWrapUp ? MODEL_DEEP : undefined, { userId, endpoint: "interview-practice" });
    // Belt-and-braces dash sweep on model-written text only (counts logged, never content).
    const swapLog = logDashSwaps("interview-practice");

    if (shouldWrapUp) {
      // Log wrapup decision
      try {
        const { logDecision, logLabel } = await import("@crucible/core");
        await logDecision({
          userId: userId ?? null,
          contextPage: "interview-practice",
          modelProvider: AI_PROVIDER,
          modelId: AI_MODEL,
          input: (messages[messages.length - 1]?.content || "").slice(0, 500),
          explanation: `Interview practice feedback wrapup. Type: ${logLabel(config.interviewType)}. ${exchangeCount} exchanges.`,
          outputSummary: {
            type: "interview_feedback",
            exchange_count: exchangeCount,
            interview_type: logLabel(config.interviewType),
            is_wrapup: true,
          },
        });
      } catch (err) {
        console.error("Decision log failed (interview wrapup):", err);
      }

      const parsed = parseInterviewFeedback(text);
      if (!parsed) {
        return NextResponse.json({
          error: "Your feedback could not be prepared. Your answers are still here. Try End & get feedback again.",
          ...(practiceSession ? { practiceSession } : {}),
        }, { status: 502 });
      }
      let feedback = parsed.feedback;
      if (feedback.better_answers?.length) {
        const sourceText = [
          typeof resume?.text === "string" ? resume.text : "",
          ...chatMessages.filter((m) => m.role === "user").map((m) => m.content),
        ].filter(Boolean).join("\n");
        const answerText = feedback.better_answers.map((answer) => answer.model_answer).join("\n\n");
        if (answerText.trim().length < 20) {
          feedback = { ...feedback, better_answers: [] };
        } else {
          const check = await verifyGrounding({ sourceText, output: answerText, kind: "report" });
          feedback = screenInterviewExamples(feedback, check);
        }
      }
      return reply(plainPunctuation({ response: parsed.closing, feedback }, swapLog));
    }

    // Log decision for JBS compliance
    try {
      const { logDecision, logLabel } = await import("@crucible/core");
      await logDecision({
        userId: userId ?? null,
        contextPage: "interview-practice",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: (messages[messages.length - 1]?.content || "").slice(0, 500),
        explanation: `Interview practice exchange #${exchangeCount}. Type: ${logLabel(config.interviewType)}.`,
        outputSummary: {
          type: "interview_exchange",
          exchange_count: exchangeCount,
          interview_type: logLabel(config.interviewType),
          is_wrapup: false,
        },
      });
    } catch (err) {
      console.error("Decision log failed (interview):", err);
    }

    return reply({ response: plainPunctuation(text, swapLog) });
  } catch (error: any) {
    console.error("Interview practice error:", error);
    // The session was counted before the AI call: give its id back, so the
    // retry continues this session instead of being charged a new one.
    return NextResponse.json(
      { error: "Could not process interview", ...(practiceSession ? { practiceSession } : {}) },
      { status: 500 }
    );
  }
}

// Text practice is not a sponsored tool (lib/premium.ts, the split): no
// `premium` here. Voice coaching stays sponsored at /api/interview-voice/token.
export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "interview", requiredTier: "client" });
