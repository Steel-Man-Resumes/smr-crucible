/**
 * POST /api/disclosure-takeaways -- Phase 5.5 "I'm done" takeaways.
 *
 * At the end of a Confidence Coach practice, the user gets a small card of warm,
 * never-shaming micro-lessons: what went well, and one thing to try next --
 * derived from the practice itself. If the user chose to SAVE the session, the
 * client also stores these takeaways on the session (endConversationSession), so
 * progressive practice (5.9) can build on them later.
 *
 * This route only READS the turns the client sends to summarize them; it never
 * persists the transcript and never logs the user's words (decision log records
 * shape only). Mock-aware.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { isMockEnabled, MOCK_DISCLOSURE_TAKEAWAYS } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  if (isMockEnabled()) {
    return NextResponse.json(MOCK_DISCLOSURE_TAKEAWAYS);
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;

    const { messages, personaLabel, hurdleLabel } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    const turns = Array.isArray(messages)
      ? messages
          .filter((m: any) => m && typeof m.content === "string" && m.content.trim())
          .slice(-14)
          .map((m: any) => `${m.role === "user" ? "THEM" : "PRACTICE PARTNER"}: ${sanitizeForPrompt(m.content, 800)}`)
          .join("\n")
      : "";

    if (!turns.trim()) {
      return NextResponse.json({ went_well: [], try_next: "" });
    }

    const prompt = `A justice-impacted jobseeker just finished a private practice conversation${
      hurdleLabel ? ` about sharing: ${sanitizeForPrompt(hurdleLabel, 80)}` : ""
    }${personaLabel ? `, practicing with a ${sanitizeForPrompt(personaLabel, 80)}` : ""}.

Read the practice below and write short, warm, encouraging takeaways. This person may carry shame -- your job is to build confidence, never to grade or criticize.

RULES:
- 2 or 3 short "what went well" notes -- specific to what they actually did.
- 1 gentle "one thing to try next" -- framed as a small, doable next step, never a failure.
- Plain, warm, 6th-grade reading level. Use "--" never an em dash. No emojis.
- Never shame. Never promise a hiring outcome.

PRACTICE:
${turns}

Return JSON ONLY:
{"went_well":["...","..."],"try_next":"..."}`;

    const text = await callAI(
      "",
      [{ role: "user", content: prompt }],
      700,
      MODEL_DEEP,
      { userId, endpoint: "disclosure-takeaways" }
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]);

    const went_well: string[] = Array.isArray(parsed.went_well)
      ? parsed.went_well
          .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 3)
          .map((s: string) => s.trim().slice(0, 300))
      : [];
    const try_next: string =
      typeof parsed.try_next === "string" ? parsed.try_next.trim().slice(0, 400) : "";

    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "disclosure-takeaways",
        modelProvider: AI_PROVIDER,
        modelId: MODEL_DEEP,
        input: `turns=${Array.isArray(messages) ? messages.length : 0}`,
        explanation: "Generated warm, non-shaming takeaways from a disclosure rehearsal",
        outputSummary: { type: "rehearsal_takeaways", went_well_count: went_well.length, has_next: !!try_next },
      });
    } catch (err) {
      console.error("Decision log failed (disclosure-takeaways):", err);
    }

    return NextResponse.json({ went_well, try_next });
  } catch (error: any) {
    console.error("Disclosure takeaways error:", error);
    return NextResponse.json({ error: "Could not build takeaways" }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "disclosure-takeaways",
  requiredTier: "client",
});
