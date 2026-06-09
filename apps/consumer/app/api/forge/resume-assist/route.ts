/**
 * Forge Resume Assist -- PRE-AUTH AI helpers for the resume builder.
 *
 * The Forge builder works logged-out, so it cannot use /api/resume-generate
 * (auth-gated, returns 401 pre-auth). This is the pre-auth twin: IP-rate-limited,
 * same pattern as the other /api/forge/* and /api/analyze surfaces. No login wall
 * before value -- the gold-mining is the value.
 *
 * Actions:
 *  - suggest_summary : a 2-3 sentence professional summary (base-resume safe)
 *  - suggest_tools   : O*NET-jogged common tools for a job title (fail-open to AI)
 *  - write_bullet    : the truth-gated bullet workshop -- the person's plain facts
 *                      -> ONE strong, TRUE, justice-reframed resume bullet
 *
 * Doctrine source: lib/skills/career-narrative/SKILL.md -- the truth gate
 * (never invent), anti-fragility reframing, evidence anchors, killing "just",
 * and reframing work-program / inside experience as real work. Encoded here as a
 * focused one-shot prompt rather than loading the full conversational skill file.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { isMockEnabled } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { getToolsForTitle } from "@/lib/onet";

export const maxDuration = 30;

const BULLET_SYSTEM = `You are an expert resume writer and career coach for justice-impacted jobseekers. You turn a person's real, plainly-stated work facts into ONE strong resume bullet.

IRON RULES (the truth gate -- never break these):
- Use ONLY the facts the person gave you. Never invent a number, a tool, a result, or a duty they did not state. If a detail is missing, leave it out -- do not guess or pad.
- No inflation. A strong TRUE bullet beats an impressive false one. Their story has to survive an interview.

HOW TO WRITE IT:
- Start with a strong, specific action verb (Operated, Trained, Tracked, Repaired, Coordinated, Maintained, Loaded, Resolved...).
- Lead with what they did; fold in the tool/process, the scale (how often / how many), and the result -- but ONLY the ones they actually gave.
- Be concrete, never generic. Kill empty phrases: no "hard worker", "team player", "results-driven", "detail-oriented".
- Never let them undersell. If they say they "just" did something, write the real skill in it.
- Reframe honestly: work done in a work program, training, or while incarcerated is REAL experience -- name the skill, not the setting. NEVER write the words incarceration, prison, jail, inmate, offender, or felon. Disclosure is handled in its own place, never on the resume.
- One sentence. Plain, dignified, true. 6th-grade reading level.

Return ONLY the bullet text -- no quotes, no bullet symbol, no preamble, no explanation.`;

async function aiSuggestTools(title: string): Promise<string[]> {
  try {
    const raw = await callAI(
      "You list common tools, equipment, systems, and software for a job, purely as memory-joggers. Reply with ONLY a comma-separated list and nothing else.",
      [
        {
          role: "user",
          content: `What tools, equipment, systems, or software does someone working as "${sanitizeForPrompt(
            title,
            120
          )}" commonly use? Give 6-10 plain names.`,
        },
      ],
      200
    );
    return raw
      .split(/[,\n]/)
      .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

async function logShape(input: string, explanation: string, summary: Record<string, unknown>) {
  try {
    const { logDecision } = await import("@crucible/core");
    await logDecision({
      contextPage: "forge-resume-assist",
      modelProvider: AI_PROVIDER,
      modelId: MODEL_DEEP,
      input: input.slice(0, 300),
      explanation,
      outputSummary: summary,
    });
  } catch (err) {
    console.error("Decision log failed (forge-resume-assist):", err);
  }
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const action: string = typeof body.action === "string" ? body.action : "";

    // --- suggest_tools: O*NET first, fail-open to AI ---
    if (action === "suggest_tools") {
      const jobTitle = sanitizeForPrompt(body.jobTitle, 120);
      if (!jobTitle) return NextResponse.json({ tools: [], source: "none" });
      if (isMockEnabled()) {
        return NextResponse.json({ tools: ["forklift", "pallet jack", "RF scanner"], source: "mock" });
      }
      let tools = await getToolsForTitle(jobTitle);
      let source = "onet";
      if (tools.length === 0) {
        tools = await aiSuggestTools(jobTitle);
        source = "ai";
      }
      return NextResponse.json({ tools, source });
    }

    // --- suggest_summary ---
    if (action === "suggest_summary") {
      if (isMockEnabled()) {
        return NextResponse.json({
          suggestion: "Reliable warehouse worker with hands-on experience in shipping and inventory. Known for showing up, learning fast, and keeping orders accurate under pressure.",
        });
      }
      const targetJob = sanitizeForPrompt(body.targetJob, 120);
      const skills = sanitizeArray(body.skills);
      const bullets = sanitizeArray(body.existingBullets, 20, 500);
      const prompt = `Write a 2-3 sentence professional summary for a resume${
        targetJob ? ` aimed at a ${targetJob} role` : ""
      }.
Their skills: ${skills || "(not specified)"}.
${bullets ? `Their experience includes: ${bullets}` : ""}

RULES:
- 6th-grade reading level. Specific, not generic. No buzzwords (no "results-driven", "detail-oriented", "hard worker").
- Honest and grounded -- only claim what the experience supports. Never invent.
- NEVER mention incarceration, a record, or justice involvement. Disclosure is handled separately.
- 2-3 sentences. Return ONLY the summary text.`;
      const suggestion = (await callAI("", [{ role: "user", content: prompt }], 300, MODEL_DEEP)).trim();
      await logShape(`summary targetJob=${targetJob}`, `Suggested a base-resume summary${targetJob ? ` for ${targetJob}` : ""}.`, {
        type: "resume_summary",
        suggestion_length: suggestion.length,
      });
      return NextResponse.json({ suggestion });
    }

    // --- write_bullet: the truth-gated bullet workshop ---
    if (action === "write_bullet") {
      const jobTitle = sanitizeForPrompt(body.jobTitle, 120);
      const company = sanitizeForPrompt(body.company, 120);
      const targetJob = sanitizeForPrompt(body.targetJob, 120);
      const a = body.answers && typeof body.answers === "object" ? body.answers : {};
      const did = sanitizeForPrompt(a.did, 600);
      const tools = sanitizeForPrompt(a.tools, 400);
      const often = sanitizeForPrompt(a.often, 200);
      const quantity = sanitizeForPrompt(a.quantity, 200);
      const improved = sanitizeForPrompt(a.improved, 400);

      if (!did && !tools && !quantity && !improved) {
        return NextResponse.json({ error: "Tell me what you did first, then I can help." }, { status: 400 });
      }

      if (isMockEnabled()) {
        const bullet = "Operated forklift and RF scanner to load and track shipments, training 3 new hires on safety.";
        return NextResponse.json({ bullet, evidence: { bullet, did, tools, often, quantity, improved } });
      }

      const userMsg = `Job title: ${jobTitle || "(not given)"}${company ? ` at ${company}` : ""}.
${targetJob ? `They are aiming for a ${targetJob} role.\n` : ""}The person's own words:
- What they did: ${did || "(blank)"}
- Tools / equipment / systems: ${tools || "(blank)"}
- How often: ${often || "(blank)"}
- How many (people, orders, shifts, units, dollars, hours): ${quantity || "(blank)"}
- What got better because of them: ${improved || "(blank)"}

Write the single strongest TRUE bullet from ONLY these facts.`;

      const bullet = (await callAI(BULLET_SYSTEM, [{ role: "user", content: userMsg }], 250, MODEL_DEEP))
        .trim()
        .replace(/^["'\s•\-]+|["']+$/g, "")
        .trim();

      await logShape(
        `bullet jobTitle=${jobTitle}`,
        `Bullet workshop generated a truth-gated bullet for ${jobTitle || "a role"}.`,
        { type: "bullet_workshop", bullet_length: bullet.length, had_quantity: !!quantity }
      );

      return NextResponse.json({
        bullet,
        evidence: { bullet, did, tools, often, quantity, improved },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("forge/resume-assist error:", error);
    return NextResponse.json({ error: "Could not generate that. Try again." }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "ip", endpoint: "forge-resume-assist" });
