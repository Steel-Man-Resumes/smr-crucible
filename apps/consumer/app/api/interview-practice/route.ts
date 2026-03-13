/**
 * Interview Practice API
 *
 * Conducts mock interviews with AI.
 * After 5-6 exchanges, provides structured feedback.
 * Adapts to role, interview type, and disclosure needs.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { messages, config, exchangeCount, forgeContext } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    const isDisclosure =
      config.interviewType === "disclosure" || config.includeDisclosure;
    const shouldWrapUp = exchangeCount >= 5;

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

    const sanitizedTargetRole = sanitizeForPrompt(config.targetRole);
    const sanitizedInterviewType = sanitizeForPrompt(config.interviewType, 100);

    let systemPrompt = `You are a hiring manager conducting a job interview${config.targetRole ? ` for a ${sanitizedTargetRole} position` : ""}.

INTERVIEW STYLE: ${sanitizedInterviewType}
${config.interviewType === "behavioral" ? "Ask STAR-method questions (Situation, Task, Action, Result). Press for specifics." : ""}
${config.interviewType === "industry" ? `Ask questions specific to the ${sanitizedTargetRole || "target"} field. Include technical and situational questions.` : ""}

YOUR ROLE:
- Be professional, warm, and realistic
- Ask one question at a time
- React naturally to their answers — acknowledge what they said before moving on
- Don't be hostile, but don't be a pushover. Ask follow-ups a real interviewer would.
- Keep your responses to 2-3 sentences max
${candidateBlock}
${isDisclosure ? `DISCLOSURE ELEMENT:
- At some point during the interview (around exchange 3-4), naturally bring up background checks
- Say something like "We do run a background check as part of our process. Is there anything you'd like to share about that?"
- React professionally to their disclosure — not too positive, not negative. Just professional.` : ""}`;

    if (shouldWrapUp) {
      // Generate feedback instead of continuing
      systemPrompt = `You were conducting a mock job interview${config.targetRole ? ` for a ${sanitizedTargetRole} position` : ""}.
${isDisclosure ? "The interview included a criminal record disclosure element." : ""}
${candidateBlock}

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
    ${isDisclosure ? '"disclosure_notes": "How they handled the disclosure moment specifically. What worked, what to adjust."' : '"disclosure_notes": null'}
  }
}

RULES:
- Be specific — reference actual things they said
- Focus on communication skills: confidence, clarity, brevity, pivot to strengths
- 6th grade reading level
- JSON only (after the closing statement)`;
    }

    const claudeMessages = messages.map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: shouldWrapUp ? 1500 : 300,
        system: systemPrompt,
        messages: claudeMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content[0]?.text || "";

    if (shouldWrapUp) {
      // Log wrapup decision
      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          contextPage: "interview-practice",
          modelProvider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
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
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
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
