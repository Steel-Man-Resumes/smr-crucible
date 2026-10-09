/**
 * Document Generation API — Resume + Cover Letter from Forge Output
 *
 * Takes Forge analysis data (narrative, strengths, skills, career paths, barriers)
 * plus optional original resume text. Returns structured resume + cover letter text.
 *
 * IP rate-limited (5/day), decision-logged.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeUserId } from "@/lib/session-policy";
import { withRateLimit } from "@/lib/withRateLimit";
import { buildForgeResumePrompts, type GenerateDocsInput } from "@/lib/forge-resume-prompt";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_DEEP } from "@/lib/ai/models";
import { verifyGrounding, buildTrustedSource } from "@/lib/grounding-verify";
import { RESUME_SOURCE_MAX, sliceWithWarn } from "@/lib/limits";
import { plainPunctuation, plainPunctuationText, logDashSwaps } from "@/lib/legal-sanitize";
import { credentialStatuses, findOverstatedCredentialLines, findOverstatedCredentials } from "@/lib/credential-truth";
import { stripUnsupportedJobCities } from "@/lib/job-line-truth";
import { withholdRecordLines } from "@/lib/record-lines";
import { letterClosingStyle } from "@/lib/letter-style";
import { accountFlags } from "@/lib/grounding-accounting";

export const maxDuration = 120;

// Forge resume + cover letter generation is a DEEP task (models.ts doctrine):
// one-shot documents whose quality changes a real outcome.
const AI_MODEL = MODEL_DEEP;

/**
 * Remove placeholder contact details, and the separator left orphaned with them.
 *
 * A name and a city is a complete, correct contact line. A fake phone number is
 * not -- it reads as carelessness to the one reader who matters.
 */
function stripContactPlaceholders(text: string): string {
  const PLACEHOLDER =
    /\(?X{3}\)?[\s.-]*X{3}[\s.-]*X{4}|email@email\.com|your\.?email@|\[\s*(?:phone|email|your [^\]]+)\s*\]|\bXXX-XXX-XXXX\b/gi;
  return text
    .split("\n")
    .map((line) => {
      if (!PLACEHOLDER.test(line)) return line;
      PLACEHOLDER.lastIndex = 0;
      const kept = line
        .split("|")
        .map((p) => p.trim())
        .filter((p) => p && !new RegExp(PLACEHOLDER.source, "i").test(p));
      return kept.join(" | ");
    })
    .join("\n");
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

    const input: GenerateDocsInput = await request.json();

    if (!input.narrative && !input.strengths && !input.skills?.length) {
      return NextResponse.json(
        { error: "No Forge output data provided. Run the analysis first." },
        { status: 400 }
      );
    }

    const startTime = Date.now();

    // Generate resume and cover letter in parallel
    const [resumeRaw, coverLetterRaw] = await Promise.all([
      generateResume(input, userId),
      generateCoverLetter(input, userId),
    ]);

    // Post-generation grounding gate (F2): claim-trace each document back to what
    // the user actually gave us and strip/generalize anything invented. The prompt
    // TRUTH GATE is necessary but the model overrides it under thin inputs (Sol's
    // "buffers and scrubbers", "clean safety record"), so this AI verify pass is
    // load-bearing. Fail-open -- a verifier hiccup never blocks or mangles a resume.
    // Source = ONLY the user's own material (their resume text + their own words),
    // never the AI-derived narrative, so invention can't launder itself as source.
    const groundingSource = buildTrustedSource({
      resumeText: input.resumeText,
      userText: [
        input.goalNarrative,
        (input.goals || []).join(", "),
        typeof input.credentialsNote === "string" ? input.credentialsNote.slice(0, 1000) : undefined,
      ],
    });

    const [resumeCheck, coverCheck] = await Promise.all([
      verifyGrounding({ sourceText: groundingSource, output: resumeRaw, kind: "resume" }),
      verifyGrounding({ sourceText: groundingSource, output: coverLetterRaw, kind: "cover_letter" }),
    ]);

    // A prompt rule is an instruction, not a guarantee. The output format
    // itself used to DEMONSTRATE "(XXX) XXX-XXXX | email@email.com", and when a
    // person supplied no phone or email the model copied the example onto the
    // finished resume. That document gets sent to an employer without being
    // re-read. Deterministic sweep, belt-and-braces like plainPunctuation.
    const swapLog = logDashSwaps("generate-docs");
    // Deterministic backstops on what the model added. An employer city the
    // person never gave is removed (a missing city harms no one). A sentence or
    // line that may overstate a credential is flagged for the person to check,
    // never deleted.
    const statuses = credentialStatuses(groundingSource);
    const cityCheck = stripUnsupportedJobCities(
      plainPunctuation(stripContactPlaceholders(resumeCheck.text), swapLog),
      groundingSource,
      { homeLocation: typeof input.preferences?.location === "string" ? input.preferences.location : undefined }
    );
    const resume = cityCheck.text;
    const coverLetter = plainPunctuation(stripContactPlaceholders(coverCheck.text), swapLog);
    const credentialChecks = [
      ...findOverstatedCredentialLines(resume, statuses).map((claim) => ({ claim, doc: "resume" as const })),
      ...findOverstatedCredentials(coverLetter, statuses, { firstPerson: true }).map((claim) => ({ claim, doc: "cover_letter" as const })),
    ];
    if (cityCheck.removed || credentialChecks.length) {
      console.warn(
        `[added-facts] generate-docs: removed ${cityCheck.removed} unsupported employer city(ies); flagged ${credentialChecks.length} possible credential overstatement(s)`
      );
    }
    // Count what the check actually did, from the text itself: a flag is "removed"
    // only if its phrase was in the original and is gone from what the person
    // receives. A flag whose phrase survived, or that can't be matched, is left for
    // the person to check. The page must never call a document clean on the
    // strength of a flag count (a letter kept "renewable" under that promise).
    const accounting = accountFlags([
      { doc: "resume", flags: resumeCheck.flags, original: resumeRaw, final: resume },
      { doc: "cover_letter", flags: coverCheck.flags, original: coverLetterRaw, final: coverLetter },
    ]);
    const clean = (claim: string) => plainPunctuationText(claim).text.slice(0, 200);
    const known = new Set(accounting.outcomes.map((o) => `${o.doc}|${o.claim.toLowerCase()}`));
    const outcomes = [
      ...accounting.outcomes,
      // Cities the backstop took out are real removals.
      ...cityCheck.removedCities.map((claim) => ({ claim: clean(claim), doc: "resume" as const, status: "removed" as const })),
      // Credential lines are left in place and listed for the person to check,
      // under their own label: they are not something the truth check tried to cut.
      ...credentialChecks
        .filter((c) => !known.has(`${c.doc}|${clean(c.claim).toLowerCase()}`))
        .map((c) => ({ claim: clean(c.claim), doc: c.doc, status: "credential" as const })),
    ];
    const removedCount = accounting.removed + cityCheck.removed;
    // Reworded, still-there and also-in items: what the truth check flagged that
    // may still be there. Credential items are counted by the page on their own.
    const residualCount = outcomes.filter((o) => o.status === "still_there" || o.status === "changed" || o.status === "also_in").length;
    const groundingFlags = [...resumeCheck.flags, ...coverCheck.flags];
    const groundingApplied = resumeCheck.applied || coverCheck.applied;
    const hasFabrication = resumeCheck.hasFabrication || coverCheck.hasFabrication;

    const latencyMs = Date.now() - startTime;

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId: userId ?? null,
        sessionId: input.sessionId ?? null,
        contextPage: "generate-docs",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: JSON.stringify({
          has_resume: !!input.resumeText,
          strengths_count: (input.strengths || input.narrative?.strengths || []).length,
          skills_count: (input.skills || []).length,
          career_paths_count: (input.career_paths || []).length,
        }),
        explanation:
          "Generated resume and cover letter documents from Forge analysis output",
        outputSummary: {
          type: "document_generation",
          resume_length: resume.length,
          cover_letter_length: coverLetter.length,
          grounding_flags: groundingFlags.length,
          grounding_applied: groundingApplied,
        },
        latencyMs,
      });
    } catch (err) {
      console.error("Decision log failed (generate-docs):", err);
    }

    // What was held back from the source (never silently): the page lists it and
    // offers to put it back.
    const { withheld: withheldLines } = withholdRecordLines(input.resumeText, input.keepInsideLines === true);
    const keptInsideLines = input.keepInsideLines === true;

    return NextResponse.json({
      resume,
      coverLetter,
      withheldLines,
      keptInsideLines,
      grounding: {
        hasFabrication,
        applied: groundingApplied,
        removed: removedCount,
        residual: residualCount,
        flags: groundingFlags,
        // Per flag: which document, and whether its phrase is gone or still there.
        outcomes,
        // Whether the check actually RAN. It fails open by design -- a missing
        // key, a timeout or an unparseable reply returns the document
        // untouched -- but that used to be invisible from here, so an outage
        // and a clean pass looked identical to every caller and to the user.
        // An unverified document is not a verified one, and the page has to be
        // able to tell the difference to say so honestly.
        verifierRan: resumeCheck.verifierRan && coverCheck.verifierRan,
        // Per document, so the page can say which one went unchecked.
        verifierRanByDoc: { resume: resumeCheck.verifierRan, cover_letter: coverCheck.verifierRan },
        hasFabricationByDoc: { resume: resumeCheck.hasFabrication, cover_letter: coverCheck.hasFabrication },
        // The check reported a problem in this document but named no phrase of its own.
        unnamedByDoc: {
          resume: resumeCheck.hasFabrication && !resumeCheck.flags.some((f) => f.claim.trim()),
          cover_letter: coverCheck.hasFabrication && !coverCheck.flags.some((f) => f.claim.trim()),
        },
        changed: accounting.changed,
        unmatched: accounting.unmatched,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Document generation error:", error);
    return NextResponse.json(
      { error: "Document generation failed. Please try again." },
      { status: 500 }
    );
  }
}

// --- Claude API helper ---

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  userId: string | null | undefined,
  maxTokens = 4000
): Promise<string> {
  return callAI(systemPrompt, [{ role: "user", content: userMessage }], maxTokens, MODEL_DEEP, { userId, endpoint: "generate-docs" });
}

// --- Resume Generation ---

async function generateResume(input: GenerateDocsInput, userId: string | null | undefined): Promise<string> {
  // Prompt text lives in lib/forge-resume-prompt.ts, built from the shared
  // resume rulebook (truth rules via the context library, page rules there).
  const { system, user } = buildForgeResumePrompts(input);
  return await callClaude(system, user, userId, 4500);
}

// --- Cover Letter Generation ---

async function generateCoverLetter(input: GenerateDocsInput, userId: string | null | undefined): Promise<string> {
  const strengths = input.strengths || input.narrative?.strengths || [];
  const skills = input.skills || [];
  const careerPaths = input.career_paths || [];
  const barriers = input.barriers || [];
  const narrative = input.narrative || {};
  const closingStyle = letterClosingStyle(
    (input.resumeText || "").split("\n").find((l) => l.trim()) || narrative.headline || ""
  );

  const system = `You are a cover letter writer for Steel Man Resumes. You write compelling, confident cover letters for people re-entering the workforce.

RULES:
- Write a GENERIC cover letter template, not targeted to a specific employer.
- The letter should work for any employer in their target career path(s).
- Use [Company Name] and [Hiring Manager] as placeholders ONLY for the employer name and contact.
- Everything else must use REAL data from the person's profile.
- 250-350 words. Professional tone with warmth.
- Do not raise a record, incarceration, supervision or any justice involvement in the letter, and never add or hint at it. That conversation is the person's to have in person. If the work history includes work done inside, you may describe the work itself (the duties and skills) without naming the facility.
- Do NOT explain employment gaps. Simply focus on what the candidate brings.
- TRUTH GATE: never fabricate achievements, experience, numbers, certifications, or personal facts (transportation, availability, physical capability, references). Every claim must come from the profile data provided.
- OPENING: never open with "I am writing to express my interest", "I am writing to apply", or "My name is". Start with a real fact from the profile: what the person does now, or something they fixed, built, ran or trained. Name the role within the first two sentences.
- FACTS AS GIVEN: state every fact the way the profile states it, in every sentence, not only the opening. Do not build a scene around it, and do not add causes, consequences, settings or reactions the person did not give ("so orders move without hold-ups", "during busy dinner service", "before a run turns into a bin of bad parts"). "I fixed the ice machine drain twice" stays exactly that size.
- SOURCES: WORK HISTORY EXCERPT is the person's own words. ABOUT, SUMMARY, KEY STRENGTHS and TOP SKILLS were written by an earlier step and can overstate. When they differ, the person's words win. Never repeat a claim about character or reliability ("dependable", "someone you can count on", "shows up ready") unless the work history says it.
- CLOSING: never use "I would welcome the opportunity", "I would welcome the chance", "Thank you for your time and consideration", "Thanks for reading", "asset to your team", "eager to bring", or "fast-paced environment". For THIS letter: ${closingStyle}
- REPEATS: never repeat a sentence, a list or a phrase you already used in the letter.
- CREDENTIAL STATUS: a finished course, class or training is not a certification or license unless the person says they passed or are certified. An expired, suspended or revoked credential is not current: never call it current, active, valid or renewable.
- VOICE: write the way a capable person talks to someone they respect. Contractions are fine ("I'm", "I've", "I'd"). Mix short sentences with longer ones. Build the letter around this person's facts so it could not be mistaken for anyone else's letter.
- Never use a dash as punctuation: no em dash and no "--". Use a period or a comma, or reword the sentence. No contrast sentences: never write "not X, but Y", "X, not Y", "X, not just Y", "more than just X" or "you're not X, you're Y". Say the positive point directly. Hyphens inside words (no-cost, part-time) are fine.`;

  const parts: string[] = [];

  if (narrative.headline) parts.push(`ABOUT: ${narrative.headline}`);
  if (narrative.summary) parts.push(`SUMMARY: ${narrative.summary}`);

  if (strengths.length > 0) {
    parts.push(
      `KEY STRENGTHS:\n${strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (skills.length > 0) {
    parts.push(`TOP SKILLS: ${skills.slice(0, 10).map((s) => s.name).join(", ")}`);
  }

  if (careerPaths.length > 0) {
    parts.push(
      `TARGET CAREER AREA: ${careerPaths[0].title} (${careerPaths[0].industry || "various industries"})`
    );
  }

  // NEVER include barriers in written documents. Disclosure happens in interviews only.

  if (input.resumeText) {
    // Strip incarceration-related content before sending to AI
    const cleanedResume = withholdRecordLines(input.resumeText, input.keepInsideLines === true).kept;
    parts.push(
      `WORK HISTORY EXCERPT:\n${sliceWithWarn(cleanedResume, RESUME_SOURCE_MAX, "generate-docs.coverLetter.resumeText")}`
    );
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${input.goals.join(", ")}`);
  }

  const prompt = `Write a professional cover letter using the data below.

${parts.join("\n\n")}

FORMAT (plain text):
Dear [Hiring Manager],

[Opening paragraph: a real fact from the profile, stated as given, and the role they want]

[Middle paragraph(s): their strongest qualifications, specific achievements, and what they bring]

[Closing paragraph: follow the CLOSING rule for this letter. No availability, start date or schedule.]

Sincerely,
[Name from resume or "Candidate"]

IMPORTANT:
- Use [Company Name] and [Hiring Manager] as the ONLY placeholders.
- Everything else must be real: real skills, real achievements, real strengths.
- 250-350 words for the body.
- Do not mention barriers, gaps, or anything the person would have to explain. That conversation happens in person.`;

  return await callClaude(system, prompt, userId);
}

export const POST = withRateLimit(handlePost, {
  mode: "forge",
  endpoint: "generate-docs",
});
