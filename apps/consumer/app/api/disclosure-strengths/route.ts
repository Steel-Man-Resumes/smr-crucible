/**
 * POST /api/disclosure-strengths -- Phase 5.2 strength discovery.
 *
 * Proposes strengths mined from the user's OWN history -- their Forge strengths,
 * any interview-practice feedback, and their prior disclosure work -- each with
 * a piece of EVIDENCE and a SOURCE. These come back LABELED as proposals ("we
 * noticed this -- does it fit?"); the client shows accept / edit / reject, and
 * only confirmed strengths feed the plan and the rehearsal. The model proposes;
 * the user decides.
 *
 * Grounded only in the user's own data. Mock-aware and decision-logged (shape,
 * never the user's words).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { isMockEnabled, MOCK_DISCLOSURE_STRENGTHS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";

export const maxDuration = 30;

interface ProposedStrength {
  title: string;
  evidence: string;
  source: string;
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  if (isMockEnabled()) {
    return NextResponse.json(MOCK_DISCLOSURE_STRENGTHS);
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;

    const { forgeContext, intakeAnswers, targetJob } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    // Gather the user's OWN history, server-side. We never invent a strength --
    // every proposal must trace to something they actually did or said.
    const historyParts: string[] = [];

    if (forgeContext?.headline) {
      historyParts.push(`Their Forge headline: ${sanitizeForPrompt(forgeContext.headline, 200)}`);
    }
    if (Array.isArray(forgeContext?.strengths) && forgeContext.strengths.length) {
      historyParts.push(
        `Forge strengths already on file:\n${forgeContext.strengths
          .map((s: any) => `- ${sanitizeForPrompt(s.title, 120)}: ${sanitizeForPrompt(s.evidence, 300)}`)
          .join("\n")}`
      );
    }
    if (Array.isArray(forgeContext?.skills) && forgeContext.skills.length) {
      historyParts.push(
        `Skills on file: ${forgeContext.skills.map((s: any) => sanitizeForPrompt(s.name || s, 60)).join(", ")}`
      );
    }
    if (Array.isArray(intakeAnswers) && intakeAnswers.length) {
      historyParts.push(
        `In their own words (recent intake):\n${intakeAnswers
          .filter((a: any) => a && typeof a.answer === "string" && a.answer.trim())
          .map((a: any) => `- ${sanitizeForPrompt(a.question, 200)}: ${sanitizeForPrompt(a.answer, 500)}`)
          .join("\n")}`
      );
    }

    // Pull the user's own interview-practice and disclosure history for evidence.
    if (userId) {
      try {
        const { listArtifacts } = await import("@crucible/core");
        const prep = await listArtifacts(userId, { type: "interview_prep", limit: 3 });
        const prepStrengths: string[] = [];
        for (const a of prep) {
          const c: any = a.content;
          const arr = c?.strengths || c?.feedback?.strengths;
          if (Array.isArray(arr)) {
            for (const s of arr) {
              const t = typeof s === "string" ? s : s?.title || s?.text;
              if (t) prepStrengths.push(sanitizeForPrompt(String(t), 160));
            }
          }
        }
        if (prepStrengths.length) {
          historyParts.push(`From interview practice feedback:\n${prepStrengths.map((s) => `- ${s}`).join("\n")}`);
        }
      } catch (err) {
        console.error("strength discovery: history read failed:", err);
      }
    }

    if (!historyParts.length) {
      // Nothing to mine -- return no proposals rather than fabricating any.
      return NextResponse.json({ proposals: [] });
    }

    const prompt = `You are a career coach for justice-impacted jobseekers. From the person's OWN history below, propose 3 to 5 real strengths they could lead with after they disclose a hurdle to an employer.

STRICT RULES:
- Only propose a strength that is clearly supported by their own history below. Never invent one.
- For each, write the EVIDENCE as a short, plain sentence that points back to what they actually did or said.
- Frame each as something for them to confirm, not a verdict. Warm, plain, 6th-grade reading level.
- Use "--" never an em dash. No emojis.
${targetJob ? `- Favor strengths that matter for: ${sanitizeForPrompt(targetJob, 120)}.` : ""}

THEIR HISTORY:
${historyParts.join("\n\n")}

Return JSON ONLY:
{"proposals":[{"title":"short strength","evidence":"one plain sentence of proof from their history","source":"Forge | interview practice | your own words"}]}`;

    const text = await callAI(
      "",
      [{ role: "user", content: prompt }],
      1000,
      MODEL_DEEP,
      { userId, endpoint: "disclosure-strengths" }
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]);
    const proposals: ProposedStrength[] = Array.isArray(parsed.proposals)
      ? parsed.proposals
          .filter((p: any) => p && typeof p.title === "string" && p.title.trim())
          .slice(0, 5)
          .map((p: any) => ({
            title: String(p.title).trim().slice(0, 160),
            evidence: String(p.evidence || "").trim().slice(0, 400),
            source: String(p.source || "your history").trim().slice(0, 60),
          }))
      : [];

    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "disclosure-strengths",
        modelProvider: AI_PROVIDER,
        modelId: MODEL_DEEP,
        input: `history_parts=${historyParts.length} target=${!!targetJob}`,
        explanation: "Proposed confirmable strengths mined from the user's own Forge/interview/disclosure history",
        outputSummary: { type: "strength_proposals", count: proposals.length },
      });
    } catch (err) {
      console.error("Decision log failed (disclosure-strengths):", err);
    }

    return NextResponse.json({ proposals });
  } catch (error: any) {
    console.error("Disclosure strengths error:", error);
    return NextResponse.json({ error: "Could not propose strengths" }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "disclosure-strengths",
  requiredTier: "client",
});
