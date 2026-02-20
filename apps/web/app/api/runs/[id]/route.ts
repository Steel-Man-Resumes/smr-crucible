import { NextResponse } from "next/server";
import { getOne, query } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../lib/api-auth";

interface RunRow {
  id: string;
  org_id: string;
  project_id: string;
  pipeline_key: string;
  pipeline_version: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface StepRow {
  id: string;
  step_key: string;
  status: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  severity: string;
  actor_label: string;
  ts: string;
  payload: Record<string, unknown>;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const run = await getOne<RunRow>(
    `SELECT id, org_id, project_id, pipeline_key, pipeline_version, status,
            started_at, finished_at, created_at
     FROM workflow_run
     WHERE id = $1 AND org_id = $2`,
    [params.id, ctx.orgId]
  );

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Get all steps, showing only the latest attempt per step_key
  const steps = await query<StepRow>(
    `SELECT DISTINCT ON (step_key) id, step_key, status, attempt,
            started_at, finished_at, error_code, error_message
     FROM run_step
     WHERE run_id = $1
     ORDER BY step_key, attempt DESC`,
    [params.id]
  );

  // Get recent events for this run
  const events = await query<EventRow>(
    `SELECT id, event_type, severity, actor_label, ts, payload
     FROM event
     WHERE run_id = $1
     ORDER BY ts DESC
     LIMIT 30`,
    [params.id]
  );

  return NextResponse.json({ run, steps, events });
}
