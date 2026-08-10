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
    const content = (artifact.content || {}) as Record<string, unknown>;

    const { getOne, query: dbQuery, invalidateNextStep } = await import("@crucible/core");

    // (2) Verify ownership of the application (user-scoped select).
    const application = await getOne<{ id: string }>(
      `SELECT id FROM job_application WHERE id = $1 AND user_id = $2`,
      [applicationId, userId]
    );
    if (!application) {
      return NextResponse.json({ error: "application_not_found" }, { status: 404 });
    }

    // (3) Attach the resume to the application (ownership-scoped UPDATE).
    await dbQuery(
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
        input: JSON.stringify({ applicationId, artifactId }).slice(0, 500),
        explanation: `Attached resume ${artifactId} to application ${applicationId} as-is (baseline_as_is). No AI rewrite.`,
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
});
