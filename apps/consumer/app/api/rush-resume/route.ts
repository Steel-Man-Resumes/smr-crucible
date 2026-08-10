/**
 * Rush Resume API Route
 *
 * Takes a rough resume + target job, returns a rewritten resume
 * with professional summary, strong bullets, and relevant skills.
 *
 * Crucible rules: only uses facts from the original resume. Never fabricates.
 * IP-rate-limited (Forge flow, no auth required).
 * Decision-logged for JBS compliance.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { callAI, AI_PROVIDER, AI_MODEL } from "@/lib/ai-call";
import { JD_MAX, RESUME_SOURCE_MAX, sliceWithWarn } from "@/lib/limits";
import {
  buildTrustedSource,
  verifyGrounding,
  verifyResumeBullets,
  verifyStructuredLists,
  aggregateVerification,
  verificationNoticeFor,
  type ResumeExperience,
} from "@/lib/grounding-verify";

export const maxDuration = 60;

interface RushInput {
  resumeText: string;
  targetJob: string;
  targetCompany?: string;
  jobDescription?: string;
}

const SYSTEM_PROMPT = `You are a professional resume rewriter for Steel Man Resumes.

You take a rough/weak resume and rewrite it for a specific target job.

RULES:
- ONLY use facts from the original resume. Never fabricate experience, employers, dates, or skills.
- Rewrite bullets with strong action verbs and quantify where the original implies scale.
- Write a new professional summary targeted to the specific job.
- Extract and organize skills relevant to the target role.
- 6th grade reading level. Short sentences. No buzzwords ("results-driven", "detail-oriented").
- If the resume is thin, work with what's there. An honest 3-bullet resume beats a fabricated 10-bullet one.
- NEVER mention incarceration, prison, jail, correctional facilities, parole, probation, criminal records, convictions, justice involvement, re-entry, or any disqualifying information. Not even obliquely. Not even with growth framing. This is a paper document and disclosure should ONLY happen in person during interviews.
- For employment gaps, simply omit or skip that period. Do NOT explain gaps. Use a functional/skills-based format if needed.
- If the original resume mentions prison, jail, incarceration, parole officers, correctional programs, etc., IGNORE those details entirely. Extract only the skills, education, and certifications gained — never mention WHERE they were earned if the location was a correctional facility.
- Parole officer references should be removed from the output entirely.
- Output JSON only.`;

async function handlePost(request: Request) {
  try {
    // IP-rate-limited Forge flow -- anonymous use is intentional (no login wall
    // before value). Attribute to a user when a session happens to exist.
    const session = await auth();
    const userId = session?.user?.id;

    const input: RushInput = await request.json();

    if (!input.resumeText?.trim()) {
      return NextResponse.json(
        { error: "Resume text is required." },
        { status: 400 }
      );
    }
    if (!input.targetJob?.trim()) {
      return NextResponse.json(
        { error: "Target job title is required." },
        { status: 400 }
      );
    }

    // Strip incarceration-related content before sending to AI
    const cleanedResume = input.resumeText
      .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.]*\./gi, '')
      .replace(/(?:I was |was )?incarcerat(?:ed|ion)[^.]*\./gi, '')
      .replace(/(?:prison|jail|correctional|waupun|penitentiary|detention)[^.]*(?:program|vocational|course|certificate|kitchen|facility)[^.]*\./gi, '')
      .replace(/(?:parole|probat(?:ion|ionary))\s*(?:officer|agent|supervisor)?[^.]*\./gi, '')
      .replace(/(?:disciplinary|infraction|conduct)[^.]*(?:issue|record|report)[^.]*\./gi, '')
      .replace(/\d{4}\s*[-–—]\s*\d{4}\s*[-–—]\s*I was/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const userMessage = `Rewrite this resume for the target job.

TARGET JOB: ${input.targetJob}${input.targetCompany ? `\nTARGET COMPANY: ${input.targetCompany}` : ""}${input.jobDescription ? `\n\nJOB DESCRIPTION:\n${sliceWithWarn(input.jobDescription, JD_MAX, "rush.jobDescription")}` : ""}

ORIGINAL RESUME:
${sliceWithWarn(cleanedResume, RESUME_SOURCE_MAX, "rush.resumeText")}

Return JSON:
{
  "summary": "2-3 sentence professional summary for the target job",
  "bullets": [
    { "text": "rewritten bullet with action verb", "original": "what it was based on from the original resume" }
  ],
  "skills": ["skill1", "skill2"],
  "tips": "One sentence of honest advice for this specific application"
}`;

    const startTime = Date.now();
    const text = await callAI(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], 4000, undefined, { userId, endpoint: "rush-resume" });
    const latencyMs = Date.now() - startTime;
    const tokenCount = undefined;

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in Claude response");

    const result = JSON.parse(jsonMatch[0]);

    // ─── Grounding gate (Rush verifier, Phase 2.4) ────────────────────────
    // Rush had no fact-check: whatever the model emitted shipped as-is. Ground
    // the summary, bullets, and skills against the user's OWN raw rush input --
    // their self-authored source, same trust boundary as resume-generate-full.
    // The deterministic incarceration-term stripping above stays; this adds the
    // semantic truth gate on top. FAIL-CLOSED: if a verifier cannot run (no key,
    // outage), surface finalizationBlocked rather than silently shipping.
    const groundingSource = buildTrustedSource({
      resumeText: typeof input.resumeText === "string" ? input.resumeText : "",
    });

    // Rush bullets are flat {text, original}. Map each to its own single-bullet
    // experience so the structured gate can ground/drop each and we can rebuild
    // by index, preserving the original-linkage the client shows.
    const rushBullets: Array<{ text?: string; original?: string }> = Array.isArray(result.bullets)
      ? result.bullets
      : [];
    const bulletExperience: ResumeExperience[] = rushBullets.map((b) => ({
      bullets: [typeof b?.text === "string" ? b.text : ""],
    }));

    const [summaryCheck, bulletCheck, listCheck] = await Promise.all([
      verifyGrounding({ sourceText: groundingSource, output: typeof result.summary === "string" ? result.summary : "", kind: "summary" }),
      verifyResumeBullets({ sourceText: groundingSource, experience: bulletExperience }),
      verifyStructuredLists({
        sourceText: groundingSource,
        skills: Array.isArray(result.skills) ? result.skills.filter((s: any) => typeof s === "string" && s.trim()) : [],
        education: [],
      }),
    ]);

    // Rebuild rush output from the grounded results.
    result.summary = summaryCheck.text || result.summary;
    result.bullets = bulletCheck.experience
      .map((e, i) => {
        const groundedText = Array.isArray(e.bullets) && e.bullets.length ? e.bullets[0] : "";
        if (!groundedText) return null; // dropped as ungrounded
        return { text: groundedText, original: rushBullets[i]?.original ?? "" };
      })
      .filter(Boolean);
    result.skills = listCheck.skills;

    const verification = aggregateVerification({
      summary: summaryCheck.verifierRan,
      bullets: bulletCheck.verifierRan,
      skills: listCheck.verifierRan,
    });
    result.verification = { ran: verification.ran, states: verification.states };
    result.finalizationBlocked = verification.finalizationBlocked;
    result.verificationNotice = verificationNoticeFor(verification);
    const groundingFlags =
      summaryCheck.flags.length + bulletCheck.flags.length + listCheck.flags.length;

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "rush-resume",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: input.resumeText.slice(0, 500),
        explanation: `Rush resume rewrite for target job: ${input.targetJob}${input.targetCompany ? ` at ${input.targetCompany}` : ""}`,
        outputSummary: {
          type: "rush_resume",
          target_job: input.targetJob,
          target_company: input.targetCompany || null,
          bullets_count: result.bullets?.length ?? 0,
          skills_count: result.skills?.length ?? 0,
          grounding_flags: groundingFlags,
          verifier_ran: verification.ran,
          finalization_blocked: verification.finalizationBlocked,
        },
        tokenCount: tokenCount ?? null,
        latencyMs,
      });
    } catch (err) {
      console.error("Decision log failed (rush-resume):", err);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rush resume error:", error);
    return NextResponse.json(
      { error: error.message || "Something went wrong. Try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "rush-resume",
});
