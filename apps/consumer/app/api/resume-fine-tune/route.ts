/**
 * Resume Fine-Tune API (Phase 2.7, 2026-08-10)
 *
 * The LIGHT counterpart to the heavy full-tailor (resume-generate-full). It does
 * NOT rewrite: it forks the user's chosen source resume into a company-named
 * fork and runs a single cheap grounded pass that re-emphasizes, reorders, and
 * adjusts the wording of the resume's OWN true content toward a specific job --
 * adding nothing not already present. The edited content is written back to the
 * (unlocked) fork, and when an applicationId is given the fork is snapshotted
 * against the application with provenance "fine_tuned".
 *
 * This closes the 1A gap where a fork from a locked baseline was not auto-linked
 * to its application: fine-tune creates that link via the snapshot.
 *
 * Uses ONLY existing 1A primitives: forkArtifact + updateArtifact +
 * snapshotApplicationDocument. Ownership is server-verified. Decision-logged.
 * Kept intentionally optional/visible -- nothing auto-invokes it; a later UI
 * phase surfaces it. Exported handler is a minimal wire-up point.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getArtifact,
  forkArtifact,
  updateArtifact,
  snapshotApplicationDocument,
} from "@crucible/core";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { JD_MAX } from "@/lib/limits";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_CHAT } from "@/lib/ai/models";
import { isMockEnabled } from "@/lib/mock-ai";
import { formatResumeDownload, migrateLegacyResume } from "@/components/resume/resumeModel";
import {
  verifyGrounding,
  verifyResumeBullets,
  verifyStructuredLists,
  buildTrustedSource,
  isDropMarker,
  isJusticeSensitive,
  aggregateVerification,
  verificationNoticeFor,
  type ResumeExperience,
} from "@/lib/grounding-verify";

export const maxDuration = 90;

// Light re-emphasis pass -- the cheaper CHAT model, not the DEEP one the full
// tailor uses. This is not a rewrite; reasoning depth is not the bottleneck.
const AI_MODEL = MODEL_CHAT;

interface FineTuneJob {
  title?: string;
  company?: string;
  description?: string;
}
interface FineTuneInput {
  sourceArtifactId?: string;
  applicationId?: string;
  job?: FineTuneJob;
}

function resumeTextFrom(content: any): string {
  const doc =
    content?.formatVersion === 2 || content?.formatVersion === 3
      ? content
      : migrateLegacyResume(content);
  return formatResumeDownload(doc);
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 2_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    const body = (await request.json()) as FineTuneInput;
    const sourceArtifactId = body.sourceArtifactId;
    const applicationId =
      typeof body.applicationId === "string" && body.applicationId.trim()
        ? body.applicationId.trim()
        : undefined;
    const job = body.job || {};

    if (typeof sourceArtifactId !== "string" || !sourceArtifactId) {
      return NextResponse.json({ error: "sourceArtifactId required" }, { status: 400 });
    }
    if (!job.title) {
      return NextResponse.json({ error: "Job title required" }, { status: 400 });
    }

    // (1) Server-resolve + verify ownership. getArtifact is ownership-scoped
    // (WHERE user_id), so a foreign or missing id reads as not_found.
    const source = await getArtifact(sourceArtifactId, userId);
    if (!source) {
      return NextResponse.json({ error: "source_not_found" }, { status: 404 });
    }

    // (2) Fork it server-side into a company-named fork. Idempotent per
    // (source, application-or-company) so a repeat fine-tune reuses the fork.
    const targetCompany = job.company || "";
    const operationKey = `fine_tune:${sourceArtifactId}:${applicationId || targetCompany || job.title}`;
    const fork = await forkArtifact({
      userId,
      sourceArtifactId,
      reason: "fine_tune",
      operationKey,
      targetContext: {
        targetJob: job.title,
        targetCompany,
        source: "job",
      },
    });
    if (fork.status === "not_found") {
      return NextResponse.json({ error: "source_not_found" }, { status: 404 });
    }
    const forkId = fork.artifact.id;
    const forkContent: any = fork.artifact.content || {};

    // Grounding source = the fork's OWN content (which is a copy of the user's
    // chosen, self-authored resume). The light pass may add nothing beyond it.
    const sourceText = resumeTextFrom(forkContent);
    const groundingSource = buildTrustedSource({ resumeText: sourceText });

    const jobTitle = sanitizeForPrompt(job.title, 200);
    const jobCompany = sanitizeForPrompt(job.company, 200);
    const jobDescription = sanitizeForPrompt(job.description, JD_MAX, "fine-tune.job.description");

    // (3) LIGHT grounded pass. Mock-aware: in mock mode we skip the AI call and
    // pass the fork's own content straight through the verifiers (deterministic).
    const baseFields = {
      summary: typeof forkContent.summary === "string" ? forkContent.summary : "",
      experience: Array.isArray(forkContent.experience) ? forkContent.experience : [],
      education: Array.isArray(forkContent.education) ? forkContent.education : [],
      skills: Array.isArray(forkContent.skills) ? forkContent.skills.filter(Boolean) : [],
    };

    let edited = baseFields;
    if (!isMockEnabled()) {
      const system = `You perform a LIGHT fine-tuning pass on an EXISTING, already-true resume for a specific target role. This is NOT a rewrite. Reorder, re-emphasize, and adjust the wording of the PROVIDED resume so the most relevant experience for this role reads first and strongest. ADD NOTHING that is not already present in the provided resume: never invent a skill, tool, number, certification, employer, title, or date. If a detail is not in the provided resume, it does not exist. Never mention incarceration, criminal records, justice involvement, parole, probation, or a facility name. Keep the same JSON shape. Use "--" never an em dash. Return ONLY the JSON object.`;
      const prompt = `Fine-tune this resume for the target role. Reorder and re-emphasize its OWN content only. Add nothing new.

<job_posting>
Title: ${jobTitle}
Company: ${jobCompany}
Description: ${jobDescription}
</job_posting>

CURRENT RESUME (the only source of facts -- do not add to it):
${JSON.stringify(
        {
          summary: baseFields.summary,
          experience: baseFields.experience,
          education: baseFields.education,
          skills: baseFields.skills,
        },
        null,
        2
      )}

Return this exact JSON structure (same content, re-emphasized -- never expanded):
{
  "summary": "re-emphasized summary using only existing facts",
  "experience": [ { "title": "", "company": "", "startDate": "", "endDate": "", "bullets": ["existing bullet, re-emphasized"] } ],
  "education": [ { "institution": "", "credential": "", "year": "" } ],
  "skills": ["existing skill"]
}`;

      try {
        const raw = await callAI(system, [{ role: "user", content: prompt }], 2500, AI_MODEL, {
          userId,
          endpoint: "resume-fine-tune",
        });
        const { extractAndParseJSON } = await import("@crucible/core");
        const parsed = extractAndParseJSON(raw);
        if (parsed && typeof parsed === "object") {
          edited = {
            summary: typeof parsed.summary === "string" ? parsed.summary : baseFields.summary,
            experience: Array.isArray(parsed.experience) ? parsed.experience : baseFields.experience,
            education: Array.isArray(parsed.education) ? parsed.education : baseFields.education,
            skills: Array.isArray(parsed.skills)
              ? parsed.skills.filter((s: any) => typeof s === "string" && s.trim())
              : baseFields.skills,
          };
        }
      } catch (err) {
        // Light pass failed -- keep the fork's own content unchanged (no-op edit).
        console.error("Fine-tune light pass failed:", err);
      }
    }

    // Verifier applied (same trust boundary as the full tailor) -- ground the
    // re-emphasized output against the resume's own content.
    const [summaryCheck, bulletCheck, listCheck] = await Promise.all([
      verifyGrounding({ sourceText: groundingSource, output: edited.summary, kind: "summary" }),
      verifyResumeBullets({
        sourceText: groundingSource,
        experience: edited.experience as ResumeExperience[],
      }),
      verifyStructuredLists({
        sourceText: groundingSource,
        skills: edited.skills,
        education: edited.education,
      }),
    ]);

    const verification = aggregateVerification({
      summary: summaryCheck.verifierRan,
      bullets: bulletCheck.verifierRan,
      lists: listCheck.verifierRan,
    });
    const finalizationBlocked = verification.finalizationBlocked;
    const verificationNotice = verificationNoticeFor(verification);
    const groundingFlags = [
      ...summaryCheck.flags,
      ...bulletCheck.flags,
      ...listCheck.flags,
    ];

    // Assemble the edited content: keep the fork's contact/meta/formatVersion,
    // override the four grounded fields. Defensive justice-sensitive blanking +
    // drop-marker filtering mirror the full tailor.
    const editedContent: Record<string, unknown> = {
      ...forkContent,
      meta: {
        ...(forkContent.meta || {}),
        targetJob: job.title || (forkContent.meta?.targetJob ?? ""),
        targetCompany: targetCompany || (forkContent.meta?.targetCompany ?? ""),
      },
      summary: summaryCheck.text || edited.summary || "",
      experience: (bulletCheck.experience || []).map((e: any) => ({
        id: e.id || crypto.randomUUID(),
        title: isJusticeSensitive(e.title) ? "" : e.title || "",
        company: isJusticeSensitive(e.company) ? "" : e.company || "",
        startDate: e.startDate || "",
        endDate: e.endDate || "",
        bullets: Array.isArray(e.bullets)
          ? e.bullets.filter((b: any) => typeof b === "string" && b.trim() && !isDropMarker(b))
          : [],
      })),
      education: (listCheck.education || []).map((e: any) => ({
        id: e.id || crypto.randomUUID(),
        institution: e.institution || "",
        credential: e.credential || "",
        year: e.year || "",
      })),
      skills: listCheck.skills || [],
    };

    // (4) Write the edited content back to the FORK (unlocked -> writable).
    const write = await updateArtifact(forkId, userId, editedContent);
    if (write.status === "locked") {
      return NextResponse.json({ error: "fork_locked" }, { status: 409 });
    }
    if (write.status === "not_found") {
      return NextResponse.json({ error: "fork_not_found" }, { status: 404 });
    }

    // (5) Link the fork to the application via a provenance snapshot -- this is
    // the 1A auto-link the fork path was missing.
    if (applicationId) {
      try {
        await snapshotApplicationDocument({
          userId,
          applicationId,
          artifactId: forkId,
          documentType: "resume",
          provenance: "fine_tuned",
          content: editedContent,
        });
      } catch (err) {
        console.error("Fine-tune snapshot failed:", err);
      }
    }

    // Decision log.
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "resume-fine-tune",
        modelProvider: AI_PROVIDER,
        modelId: AI_MODEL,
        input: JSON.stringify({ sourceArtifactId, jobTitle: job.title, jobCompany: job.company }).slice(0, 500),
        explanation: `Light fine-tune of resume ${sourceArtifactId} -> fork ${forkId} for ${job.title}${job.company ? ` at ${job.company}` : ""}.`,
        outputSummary: {
          type: "resume_fine_tune",
          fork_id: forkId,
          deduped: fork.deduped,
          application_id: applicationId || null,
          grounding_flags: groundingFlags.length,
          verifier_ran: verification.ran,
          finalization_blocked: finalizationBlocked,
        },
      });
    } catch (err) {
      console.error("Decision log failed (resume-fine-tune):", err);
    }

    return NextResponse.json({
      forkId,
      deduped: fork.deduped,
      content: editedContent,
      grounding: { flags: groundingFlags },
      verification: { ran: verification.ran, states: verification.states },
      finalizationBlocked,
      verificationNotice,
    });
  } catch (error: any) {
    console.error("Resume fine-tune error:", error);
    return NextResponse.json(
      { error: "Could not fine-tune this resume. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "resume-fine-tune",
  requiredTier: "client",
});
