import { NextResponse } from "next/server";
import { insert, query, emitEvent } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";
import { getQueue } from "../../../../../lib/queue";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const projectId = params.id;

  // Verify project exists and belongs to user's org
  const project = await import("@crucible/core").then(({ getOne }) =>
    getOne<{ id: string }>(
      `SELECT id FROM project WHERE id = $1 AND org_id = $2`,
      [projectId, ctx.orgId]
    )
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Verify at least one uploaded document exists
  const docs = await query<{ id: string }>(
    `SELECT id FROM document WHERE project_id = $1 AND org_id = $2 AND source = 'user_upload' LIMIT 1`,
    [projectId, ctx.orgId]
  );

  if (docs.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one document before running analysis" },
      { status: 400 }
    );
  }

  // Create workflow_run record
  const run = await insert<{ id: string; correlation_id: string }>("workflow_run", {
    org_id: ctx.orgId,
    project_id: projectId,
    pipeline_key: "career_intake_v1",
    pipeline_version: "1.0",
    status: "queued",
    created_by_user_id: ctx.userId,
  });

  // Emit RUN_QUEUED event
  await emitEvent({
    org_id: ctx.orgId,
    project_id: projectId,
    run_id: run.id,
    step_id: null,
    event_type: "RUN_QUEUED",
    severity: "info",
    actor_type: "user",
    actor_user_id: ctx.userId,
    actor_label: ctx.email,
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: run.correlation_id,
    parent_event_id: null,
    payload: { pipeline_key: "career_intake_v1" },
    sensitive_ref: null,
  });

  // Enqueue job to Redis
  const queue = getQueue();
  await queue.add("pipeline-run", {
    runId: run.id,
    orgId: ctx.orgId,
    projectId,
    userId: ctx.userId,
    pipelineKey: "career_intake_v1",
  });

  return NextResponse.json({ runId: run.id }, { status: 201 });
}
