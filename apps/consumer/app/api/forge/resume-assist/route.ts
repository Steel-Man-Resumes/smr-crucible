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
import { auth } from "@/auth";
import { forgeUserId } from "@/lib/session-policy";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray, sanitizeOrEmpty } from "@/lib/sanitize";
import { isMockEnabled } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { plainPunctuation, logDashSwaps } from "@/lib/legal-sanitize";
import { unsupportedNumbers } from "@/lib/number-truth";
import { MODEL_DEEP } from "@/lib/ai/models";
import { getToolsForTitle } from "@/lib/onet";
import { resumeRulesBlock } from "@crucible/core/src/resumeRules";

export const maxDuration = 30;

const BULLET_SYSTEM = `You are an expert resume writer and career coach for people with records. You turn a person's real, plainly-stated work facts into ONE strong resume bullet.

IRON RULES (the truth gate). Never break these:
- Use ONLY the facts the person gave you. Never invent a number, a tool, a result, or a duty they did not state. If a detail is missing, leave it out. Do not guess or pad.
- No inflation. A strong TRUE bullet beats an impressive false one. Their story has to survive an interview.

HOW TO WRITE IT:
- Start with a plain, specific action verb their words support (Operated, Tracked, Repaired, Maintained, Loaded...). Never a bigger verb than what they did: "trained" or "led" only if they said so.
- Lead with what they did; fold in the tool/process, the scale (how often / how many), and the result, but ONLY the ones they actually gave.
- Be concrete, never generic. Kill empty phrases: no "hard worker", "team player", "results-driven", "detail-oriented".
- Never let them undersell. If they say they "just" did something, name the real skill in it, at its true size. Shared or supervised work stays shared or supervised ("helped with X under the lead" when that is what they said).
- A number they gave as a range or a bound stays exactly that ("about 6 to 10", "under 50", "more than 25"). Never turn it into one exact number.
- Reframe honestly: work done in a work program, training, or while incarcerated is REAL experience. Name the skill, not the setting. NEVER write the words incarceration, prison, jail, inmate, offender, or felon. Disclosure is handled in its own place, never on the resume.
- One sentence. Plain, dignified, true. 6th-grade reading level.
- Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence.

${resumeRulesBlock("truth")}

Return ONLY the bullet text: no quotes, no bullet symbol, no preamble, no explanation.`;

async function aiSuggestTools(title: string, userId: string | null | undefined): Promise<string[]> {
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
      200,
      undefined,
      { userId, endpoint: "resume-assist" }
    );
    // Model-written list shown to the person: split on dashes as well as commas,
    // then sweep what is left.
    const items = raw
      .split(/[,\n]|\s*(?:\u2014|--)\s*/)
      .map((s) => s.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 12);
    return plainPunctuation(items, logDashSwaps("forge-resume-assist"));
  } catch {
    return [];
  }
}

async function logShape(
  userId: string | null,
  input: string,
  explanation: string,
  summary: Record<string, unknown>
) {
  try {
    const { logDecision } = await import("@crucible/core");
    await logDecision({
      userId,
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
    // IP-rate-limited pre-auth Forge flow -- anonymous use is intentional (no
    // login wall before value). Attribute to a user when a session happens to exist.
    const session = await auth();
    // Never credited to a session that still owes its two-step code.
    const userId = forgeUserId(session);

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
        tools = await aiSuggestTools(jobTitle, userId);
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
- Honest and grounded: only claim what the experience supports. Never invent.
- NEVER mention incarceration, a record, or justice involvement. Disclosure is handled separately.
- Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence.
- 2-3 sentences.

${resumeRulesBlock("truth")}

Return ONLY the summary text.`;
      const suggestion = plainPunctuation(
        (await callAI("", [{ role: "user", content: prompt }], 300, MODEL_DEEP, { userId, endpoint: "resume-assist" })).trim(),
        logDashSwaps("forge-resume-assist")
      );
      await logShape(userId ?? null, `summary targetJob=${targetJob}`, "Suggested a base-resume summary.", {
        type: "resume_summary",
        suggestion_length: suggestion.length,
      });
      return NextResponse.json({ suggestion });
    }

    // --- write_bullet: the truth-gated bullet workshop ---
    if (action === "write_bullet") {
      // Blank stays blank here: these answers are saved with the bullet, and the
      // empty check below has to be able to see an empty answer.
      const jobTitle = sanitizeOrEmpty(body.jobTitle, 120);
      const company = sanitizeOrEmpty(body.company, 120);
      const targetJob = sanitizeOrEmpty(body.targetJob, 120);
      const a = body.answers && typeof body.answers === "object" ? body.answers : {};
      const did = sanitizeOrEmpty(a.did, 600);
      const tools = sanitizeOrEmpty(a.tools, 400);
      const often = sanitizeOrEmpty(a.often, 200);
      const quantity = sanitizeOrEmpty(a.quantity, 200);
      const improved = sanitizeOrEmpty(a.improved, 400);

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

Write the single strongest TRUE bullet from ONLY these facts.${
        a.quantitySource === "picked"
          ? `\nThe "How many" answer is a range they picked because they don't know the exact number. Keep it as a range, with its words (about, under, more than).`
          : ""
      }`;

      // Sweep dashes BEFORE the quote/bullet strip, so a leading em dash (which the
      // sweep turns into "- ") is then removed by the strip instead of surviving.
      const writeBullet = async (messages: { role: "user" | "assistant"; content: string }[]) =>
        plainPunctuation(
          (await callAI(BULLET_SYSTEM, messages, 250, MODEL_DEEP, { userId, endpoint: "resume-assist" })).trim(),
          logDashSwaps("forge-resume-assist")
        )
          .replace(/^["'\s•\-]+|["']+$/g, "")
          .trim();

      // Every number in the bullet must be one the person typed or picked. The
      // prompt says so; this check makes it hold. One rewrite, then refuse.
      // Only the person's answers supply numbers: never the job title, company or
      // target job (a posting's title is not their words). The "How many?" answer is
      // checked strictly, so a picked range can never become one exact figure.
      const ownWords = [did, tools, often, improved].join("\n");
      let bullet = await writeBullet([{ role: "user", content: userMsg }]);
      let invented = unsupportedNumbers(bullet, ownWords, quantity);
      let numberCheck: "clean" | "rewritten" | "refused" = "clean";
      if (invented.length) {
        bullet = await writeBullet([
          { role: "user", content: userMsg },
          { role: "assistant", content: bullet },
          {
            role: "user",
            content: `That bullet uses a number the person never gave (${invented.join(", ")}). Write it again using only numbers from their own words above. If they gave no number, use none.`,
          },
        ]);
        invented = unsupportedNumbers(bullet, ownWords, quantity);
        numberCheck = invented.length ? "refused" : "rewritten";
      }

      await logShape(
        userId ?? null,
        `bullet jobTitle=${jobTitle}`,
        "Bullet workshop generated a truth-gated bullet.",
        { type: "bullet_workshop", bullet_length: bullet.length, had_quantity: !!quantity, number_check: numberCheck }
      );

      if (numberCheck === "refused") {
        return NextResponse.json(
          { error: "That draft used a number you didn't give us, so we didn't show it. Try again, or type the number in yourself if it's true." },
          { status: 422 }
        );
      }

      const quantitySource = ["typed", "picked", "unsure"].includes(a.quantitySource) ? a.quantitySource : undefined;
      return NextResponse.json({
        bullet,
        // Only the answers the person actually gave.
        evidence: {
          bullet,
          ...Object.fromEntries(Object.entries({ did, tools, often, quantity, improved }).filter(([, v]) => v)),
          ...(quantitySource ? { quantitySource } : {}),
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("forge/resume-assist error:", error);
    return NextResponse.json({ error: "Could not generate that. Try again." }, { status: 500 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "forge", endpoint: "forge-resume-assist" });
