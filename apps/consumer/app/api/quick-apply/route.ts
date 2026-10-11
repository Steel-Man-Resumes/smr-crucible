/**
 * Quick Apply API (Phase 3.3, 2026-08-10)
 *
 * The honest "I am sending my existing resume as-is" path. It attaches a resume
 * the user already approved to a saved job WITHOUT any AI rewrite, and records a
 * provenance snapshot with provenance "baseline_as_is". That provenance is what
 * keeps the "tailored" gate honest: baseline_as_is is deliberately NOT in the
 * set (tailored, fine_tuned) that flips hasTailoredDocument / resumeTailored, so
 * sending a resume as-is never counts as customizing it for the job.
 *
 * No model call, so no AI cost -- still rate-limited (a write endpoint), still
 * decision-logged. Ownership of BOTH the artifact and the application is
 * server-verified before anything is written.
 *
 * WHICH VERSION (Phase 5 R1, review A3). What is attached is a saved
 * revision (migration 081): the one the page names (`revisionId`, the
 * person's own and of this resume), or the revision that IS this resume now
 * (lib/revision-current.ts), made from the stored content when there is none.
 * Its status is the server's. A finished revision attaches. A draft does NOT
 * attach unless the request says `acceptDraft: true` after the person was
 * told it is a draft; then the record says draft, plainly. The snapshot holds
 * the revision's exact text, so "what did I send" is the version itself.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getArtifact,
  snapshotApplicationDocument,
} from "@crucible/core";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 10;

interface QuickApplyInput {
  applicationId?: string;
  artifactId?: string;
  /** A saved revision of this resume (081). Optional: the current one is used. */
  revisionId?: string;
  /** The person saw it is a draft and chose to attach it anyway. */
  acceptDraft?: boolean;
}

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 100_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as QuickApplyInput;
    const applicationId =
      typeof body.applicationId === "string" ? body.applicationId.trim() : "";
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId.trim() : "";

    if (!applicationId) {
      return NextResponse.json({ error: "applicationId required" }, { status: 400 });
    }
    if (!artifactId) {
      return NextResponse.json({ error: "artifactId required" }, { status: 400 });
    }

    // (1) Verify ownership of the resume. getArtifact is ownership-scoped, so a
    // foreign / missing id reads as not found.
    const artifact = await getArtifact(artifactId, userId);
    if (!artifact) {
      return NextResponse.json({ error: "resume_not_found" }, { status: 404 });
    }
    // Creative documents (statement, bio, artist resume) are never sent as a resume.
    const { isCreativeType } = await import("@crucible/core");
    if (isCreativeType(artifact.artifact_type)) {
      return NextResponse.json({ error: "creative_doc", message: "Creative documents can't be sent as a resume." }, { status: 409 });
    }
    const { getOneAsUser, queryAsUser, invalidateNextStep, getRevision } = await import("@crucible/core");

    // (1b) The version: the named revision (the person's own, of THIS
    // resume), or the one that is this resume now. The server's status.
    const { coreStore } = await import("@/lib/revision-save");
    const { ensureExportRevision } = await import("@/lib/revision-current");
    let revision = null as Awaited<ReturnType<typeof getRevision>>;
    if (typeof body.revisionId === "string" && body.revisionId) {
      revision = await getRevision(userId, body.revisionId);
      if (!revision || revision.artifact_id !== artifactId) {
        return NextResponse.json({ error: "revision_not_found" }, { status: 404 });
      }
    } else {
      const ex = await ensureExportRevision(userId, artifactId, await coreStore());
      if (!ex.ok) {
        return NextResponse.json(
          { error: ex.reason === "not_ready" ? "not_ready" : "no_version", message: "We couldn't prepare a saved version of this resume to attach." },
          { status: ex.status === 404 ? 404 : 409 }
        );
      }
      revision = ex.revision;
    }
    const draft = revision.status !== "finished";
    if (draft && body.acceptDraft !== true) {
      return NextResponse.json(
        {
          error: "draft",
          message: "This resume is still a draft. Finish it first, or attach it marked as a draft.",
          revisionId: revision.id,
          openItems: Array.isArray(revision.open_items) ? revision.open_items : [],
        },
        { status: 409 }
      );
    }
    // What was attached: the version's own text and its status, never the page's.
    const content: Record<string, unknown> = {
      revision: { id: revision.id, number: revision.revision_number, status: revision.status, checker: revision.checker_version },
      resumeText: revision.resume_text,
      ...(draft ? { draft: true, openItems: revision.open_items } : {}),
    };

    // (2) Verify ownership of the application (user-scoped select).
    const application = await getOneAsUser<{ id: string }>(userId, 
      `SELECT id FROM job_application WHERE id = $1 AND user_id = $2`,
      [applicationId, userId]
    );
    if (!application) {
      return NextResponse.json({ error: "application_not_found" }, { status: 404 });
    }

    // (3) Attach the resume to the application (ownership-scoped UPDATE).
    // Owner-only under row-level security: written AS the person. This one was
    // an aliased import (`query: dbQuery`), which both the converter and the
    // first version of the lint walked past.
    await queryAsUser(userId,
      `UPDATE job_application SET resume_artifact_id = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3`,
      [artifactId, applicationId, userId]
    );

    // (4) Immutable provenance snapshot. baseline_as_is -- NOT tailored. This is
    // the record that "I sent my existing resume, unchanged."
    const snapshot = await snapshotApplicationDocument({
      userId,
      applicationId,
      artifactId,
      documentType: "resume",
      provenance: "baseline_as_is",
      content,
    });

    // Attaching materials can move the journey (Stage 3) -- recompute the cache.
    await invalidateNextStep(userId).catch(() => {});

    // Decision log (no model, but an auditable user action).
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId,
        contextPage: "quick-apply",
        modelProvider: "none",
        modelId: "none",
        input: JSON.stringify({ applicationId, artifactId, revisionId: revision.id }).slice(0, 500),
        explanation: `Attached resume ${artifactId} (version ${revision.revision_number}, ${draft ? "draft" : "finished"}) to application ${applicationId} as-is (baseline_as_is). No AI rewrite.`,
        outputSummary: {
          type: "quick_apply",
          provenance: "baseline_as_is",
          snapshot_id: snapshot.id,
        },
      });
    } catch (err) {
      console.error("Decision log failed (quick-apply):", err);
    }

    return NextResponse.json({
      ok: true,
      revision: { id: revision.id, number: revision.revision_number, status: revision.status },
      snapshot: {
        id: snapshot.id,
        provenance: snapshot.provenance,
        contentHash: snapshot.content_hash,
      },
    });
  } catch (error: any) {
    console.error("Quick-apply error:", error);
    return NextResponse.json(
      { error: "Could not attach your resume right now. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "quick-apply",
  requiredTier: "client",
  premium: "one_click_apply",
});
