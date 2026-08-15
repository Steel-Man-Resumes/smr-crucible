/**
 * Disclosure Guide API
 *
 * Generates a personalized disclosure plan based on:
 * - Type of conviction
 * - Recency
 * - Jurisdiction (ban-the-box laws)
 * - User's preferred timing
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";
import { buildFullContext, type UserContext } from "@/lib/context-library";
import { isMockEnabled, MOCK_DISCLOSURE_PLAN } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { getHurdleGuidance, isRecordHurdle } from "@/lib/hurdle-guidance";

export const maxDuration = 30;

// A disclosure plan is a DEEP task (models.ts doctrine): one-shot synthesis
// where quality changes a real outcome for the user.
const AI_MODEL = MODEL_DEEP;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // Route is mode:"user" in withRateLimit, so a session is guaranteed by
  // the time handlePost runs -- re-derive here to attribute the AI call.
  const session = await auth();
  const userId = session?.user?.id;

  const { record, timing, targetJob, forgeContext, refinementNote, intakeAnswers, hurdle } =
    await request.json();

  // Phase 5.3: the criminal-record hurdle keeps the full jurisdiction /
  // ban-the-box path below. Any OTHER hurdle gets STATIC, legal-reviewed
  // coaching (lib/hurdle-guidance) -- the model may personalize the timing,
  // script, and tips, but it is NEVER allowed to state law for non-record
  // hurdles, and the "what you have to share" text is injected verbatim.
  const isRecord = isRecordHurdle(hurdle) || hurdle === undefined || hurdle === null;

  if (isMockEnabled()) {
    if (isRecord) return NextResponse.json(MOCK_DISCLOSURE_PLAN);
    const g = getHurdleGuidance(hurdle);
    return NextResponse.json({
      timing_advice:
        "You get to choose when and whether to bring this up. Often the best moment is after they already see you are a strong fit -- later in the process, not on the first form.",
      legal_context: g.coachingFrame,
      script: g.scriptScaffold,
      tips: [
        "Keep it short -- a sentence or two, then move on.",
        "Pivot straight to a real strength.",
        "You do not owe anyone more detail than you want to give.",
        "Practice it out loud until it feels natural.",
      ],
    });
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 500 }
      );
    }

    // ── Non-record hurdle: coaching frames only, no fabricated law ──────────
    if (!isRecord) {
      const g = getHurdleGuidance(hurdle);

      let intakeLines = "";
      if (Array.isArray(intakeAnswers) && intakeAnswers.length) {
        intakeLines = intakeAnswers
          .filter((a: any) => a && typeof a.answer === "string" && a.answer.trim())
          .map((a: any) => `- ${sanitizeForPrompt(a.question, 200)}: ${sanitizeForPrompt(a.answer, 500)}`)
          .join("\n");
      }
      const strengthsLine =
        forgeContext?.strengths?.length
          ? forgeContext.strengths.map((s: any) => sanitizeForPrompt(s.title, 120)).join(", ")
          : "";

      const nonRecordPrompt = `You are a supportive career coach helping a justice-impacted jobseeker prepare to talk about a hurdle that is NOT a criminal record. The hurdle is: ${sanitizeForPrompt(g.label, 80)}.

USE THIS REVIEWED COACHING FRAME as your foundation (do not contradict it):
${g.coachingFrame}

STARTER SCRIPT SHAPE (personalize it, keep their voice):
${g.scriptScaffold}

${targetJob ? `TARGET ROLE: ${sanitizeForPrompt(targetJob, 120)}` : ""}
${strengthsLine ? `STRENGTHS TO PIVOT TO: ${strengthsLine}` : ""}
${intakeLines ? `IN THEIR OWN WORDS:\n${intakeLines}` : ""}
${refinementNote ? `\nREFINEMENT REQUEST: ${sanitizeForPrompt(refinementNote, 500)}` : ""}

ABSOLUTE RULES:
- This is coaching, NOT legal advice. Do NOT state any law, statute, rule, ordinance, "your rights," or protection. Do NOT name any agency or act. If they ask about legal questions, tell them to check with a local job coach or legal aid -- do not answer it yourself.
- Never ask them to share private detail they do not want to share. Reinforce that they choose how much to say.
- Warm, plain, 6th-grade reading level. Use "--" never an em dash. No emojis.

Return JSON ONLY:
{
  "timing_advice": "When and whether to bring it up, in plain coaching language. No legal claims.",
  "script": "A natural script under 30 seconds spoken, in their voice, that keeps it short and pivots to strength.",
  "tips": ["tip 1","tip 2","tip 3","tip 4"]
}`;

      const raw = await callAI("", [{ role: "user", content: nonRecordPrompt }], 1200, MODEL_DEEP, {
        userId,
        endpoint: "disclosure-guide",
      });
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON in response");
      const parsed = JSON.parse(m[0]);
      // legal_context is the STATIC reviewed frame, injected verbatim -- never
      // model-generated, so no fabricated statute can reach the user.
      const nonRecordResult = {
        timing_advice: typeof parsed.timing_advice === "string" ? parsed.timing_advice : "",
        legal_context: g.coachingFrame,
        script: typeof parsed.script === "string" ? parsed.script : g.scriptScaffold,
        tips: Array.isArray(parsed.tips)
          ? parsed.tips.filter((t: unknown): t is string => typeof t === "string").slice(0, 6)
          : [],
      };

      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          contextPage: "disclosure-guide",
          modelProvider: AI_PROVIDER,
          modelId: AI_MODEL,
          input: JSON.stringify({ hurdle: g.id, timing }).slice(0, 500),
          explanation: `Generated non-record hurdle coaching (${g.id}) from static reviewed guidance -- no legal claims`,
          outputSummary: {
            type: "disclosure_plan_hurdle",
            hurdle: g.id,
            review_date: g.reviewDate,
            has_script: !!nonRecordResult.script,
            tips_count: nonRecordResult.tips.length,
          },
        });
      } catch (err) {
        console.error("Decision log failed (disclosure hurdle):", err);
      }

      return NextResponse.json(nonRecordResult);
    }

    // Build candidate profile from Forge data
    let candidateBlock = "";
    if (targetJob || forgeContext) {
      const parts: string[] = [];
      if (targetJob) parts.push(`Target role: ${sanitizeForPrompt(targetJob)}`);
      if (forgeContext?.headline) parts.push(`Professional headline: ${sanitizeForPrompt(forgeContext.headline)}`);
      if (forgeContext?.strengths?.length) {
        parts.push(`Key strengths to pivot to after disclosure: ${forgeContext.strengths.map((s: any) => `${sanitizeForPrompt(s.title)}: ${sanitizeForPrompt(s.evidence)}`).join("; ")}`);
      }
      if (forgeContext?.skills?.length) {
        parts.push(`Top skills: ${sanitizeArray(forgeContext.skills.map((s: any) => s.name))}`);
      }
      candidateBlock = `\n\nCANDIDATE PROFILE:\n${parts.join("\n")}`;
    }

    // Enriched progressive-intake answers -- the user's own words about how they
    // want to tell their story. Used to personalize the script + pivot; never
    // stored as an artifact (doctrine: keep the frame, not the user's words).
    let intakeBlock = "";
    if (Array.isArray(intakeAnswers) && intakeAnswers.length) {
      const lines = intakeAnswers
        .filter((a: any) => a && typeof a.answer === "string" && a.answer.trim())
        .map((a: any) => `- ${sanitizeForPrompt(a.question, 200)}: ${sanitizeForPrompt(a.answer, 600)}`)
        .join("\n");
      if (lines) {
        intakeBlock = `\n\nIN THEIR OWN WORDS (how they want to tell their story -- weave this into the script and the pivot so it sounds like them; do not quote verbatim):\n${lines}`;
      }
    }

    // Build research-backed context
    const userCtx: UserContext = {
      strengths: forgeContext?.strengths || [],
      skills: forgeContext?.skills || [],
      narrative: forgeContext?.headline || undefined,
      criminalRecord: record,
      barriers: ["criminal_record"],
    };
    const disclosureResearch = buildFullContext("disclosure", userCtx, { targetJob });

    // Derive jurisdiction from forge context location (preferences.location)
    const locationRaw = sanitizeForPrompt(forgeContext?.location || forgeContext?.preferences?.location || "", 200);
    const stateMatch = locationRaw.match(/,\s*([A-Z]{2})$/) || locationRaw.match(/\b([A-Z]{2})\b/);
    const jurisdiction = stateMatch ? stateMatch[1] : (sanitizeForPrompt(record.state || "", 10) || "Wisconsin");

    const prompt = `${disclosureResearch}

You are a reentry career specialist helping someone plan how to disclose their criminal record to employers.

THEIR SITUATION:
- Charge type: ${sanitizeForPrompt(record.type)}
- Number of charges: ${sanitizeForPrompt(record.charge_count)}
- Most recent: ${sanitizeForPrompt(record.most_recent)}
- Probation/parole: ${sanitizeForPrompt(record.supervision)}
- State/Jurisdiction: ${jurisdiction}
- Preferred timing: ${sanitizeForPrompt(timing, 200) || "not sure"}${candidateBlock}${intakeBlock}

JURISDICTION-SPECIFIC CONTEXT:
${jurisdiction === "WI" || jurisdiction === "Wisconsin" ? `Wisconsin ban-the-box: state/county government employers cannot ask about criminal history on applications. Milwaukee city ordinance extends to private employers with 15+ employees. Expungement eligibility: WI s.973.015 allows expungement for offenses committed under age 25, or for misdemeanors/minor felonies with no prior felony convictions. Process takes 6-18 months. Provide this specific guidance (this block is curated and current -- you may cite it).` : `Jurisdiction is ${jurisdiction}. You cannot look up current law, so describe protections GENERALLY: many states and cities have ban-the-box / fair-chance rules that limit when employers may ask about records, and most states have some record-clearing process. Do NOT cite specific statute numbers, ordinance names, or eligibility rules for ${jurisdiction} unless you are certain they are real and current -- a wrong citation harms the user. Instead, name the general protection type and direct them to verify with a local reentry legal aid organization.`}

GENERATE a disclosure plan as JSON:
{
  "timing_advice": "When they should disclose and why, specific to their situation and jurisdiction. Apply the ban-the-box rules for their state.",
  "legal_context": "Rights and protections relevant to their jurisdiction, framed as general information to verify -- not legal advice. Cite a specific statute ONLY from the curated context above; otherwise describe the protection generally and point to local legal aid.",
  "script": "A natural, conversational script they can use. Under 30 seconds spoken. Acknowledges the past, pivots to growth and value. If candidate strengths are provided, reference them specifically in the pivot. Must sound human, not rehearsed.",
  "tips": [
    "tip 1 -- specific, actionable",
    "tip 2",
    "tip 3",
    "tip 4"
  ]
}

${refinementNote ? `\nREFINEMENT REQUEST (adjust the plan to address this):\n${sanitizeForPrompt(refinementNote, 500)}\n` : ""}RULES:
- Be honest but empowering
- This is career coaching, not legal advice -- never present legal information as advice, and never invent statutes or eligibility rules
- The script should acknowledge the record briefly, then pivot to what they've done since and what they bring
- For felonies 10+ years old, note that many employers care less about old records
- Never minimize what happened, but always connect to growth
- 6th grade reading level. Use "--" never an em dash
- JSON only`;

    const text = await callAI("", [{ role: "user", content: prompt }], 1500, MODEL_DEEP, { userId, endpoint: "disclosure-guide" });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const result = JSON.parse(jsonMatch[0]);

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "disclosure-guide",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: JSON.stringify({ record, timing }).slice(0, 500),
        explanation: "Generated disclosure plan based on criminal record type, recency, and jurisdiction",
        outputSummary: {
          type: "disclosure_plan",
          has_script: !!result.script,
          tips_count: result.tips?.length ?? 0,
        },
      });
    } catch (err) {
      console.error("Decision log failed (disclosure):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Disclosure guide error:", error);
    return NextResponse.json(
      { error: "Could not generate plan" },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "disclosure", requiredTier: "client" });
