import { NextResponse } from "next/server";
import { getOne, query, emitEvent } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";

interface ArtifactRow {
  id: string;
  org_id: string;
  run_id: string;
  project_id: string;
  artifact_type: string;
  review_status: string;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const body = await request.json();
  const { action } = body;

  if (!action || !["approved", "rejected"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }

  const artifact = await getOne<ArtifactRow>(
    `SELECT id, org_id, run_id, project_id, artifact_type, review_status
     FROM artifact
     WHERE id = $1 AND org_id = $2`,
    [params.id, ctx.orgId]
  );

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  // Update review status
  await query(
    `UPDATE artifact
     SET review_status = $1, reviewed_by_user_id = $2, reviewed_at = now()
     WHERE id = $3`,
    [action, ctx.userId, params.id]
  );

  // Emit review event
  const eventType = action === "approved" ? "HUMAN_REVIEW_APPROVED" : "HUMAN_REVIEW_REJECTED";
  await emitEvent({
    org_id: ctx.orgId,
    project_id: artifact.project_id,
    run_id: artifact.run_id,
    step_id: null,
    event_type: eventType,
    severity: "info",
    actor_type: "user",
    actor_user_id: ctx.userId,
    actor_label: ctx.email,
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: null,
    parent_event_id: null,
    payload: {
      artifact_id: artifact.id,
      artifact_type: artifact.artifact_type,
      action,
    },
    sensitive_ref: null,
  });

  // Return updated artifact
  const updated = await getOne<ArtifactRow & { reviewed_at: string }>(
    `SELECT id, org_id, run_id, project_id, artifact_type, review_status, reviewed_at
     FROM artifact WHERE id = $1`,
    [params.id]
  );

  return NextResponse.json({ artifact: updated });
}
