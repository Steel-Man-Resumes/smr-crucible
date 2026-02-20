import { query } from "./db";
import type { CrucibleEvent, EventType } from "./types";

type EmitEventInput = Omit<CrucibleEvent, "id" | "ts">;

export async function emitEvent(event: EmitEventInput): Promise<CrucibleEvent> {
  const rows = await query<CrucibleEvent>(
    `INSERT INTO event (
      org_id, project_id, run_id, step_id,
      event_type, severity, actor_type, actor_user_id, actor_label,
      data_classification, retention_class,
      correlation_id, parent_event_id,
      payload, sensitive_ref
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11,
      $12, $13,
      $14, $15
    ) RETURNING *`,
    [
      event.org_id,
      event.project_id,
      event.run_id,
      event.step_id,
      event.event_type,
      event.severity,
      event.actor_type,
      event.actor_user_id,
      event.actor_label,
      event.data_classification,
      event.retention_class,
      event.correlation_id,
      event.parent_event_id,
      JSON.stringify(event.payload),
      event.sensitive_ref,
    ]
  );
  return rows[0];
}

// --- Step Context Helpers ---

import type { StepContext } from "./pipeline";

export async function emitStepEvent(
  ctx: StepContext,
  eventType: EventType,
  payload: Record<string, unknown>
): Promise<CrucibleEvent> {
  return emitEvent({
    org_id: ctx.orgId,
    project_id: ctx.projectId,
    run_id: ctx.runId,
    step_id: ctx.stepId || null,
    event_type: eventType,
    severity: eventType.includes("FAILED") ? "error" : "info",
    actor_type: "system",
    actor_user_id: null,
    actor_label: "pipeline-runner",
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: ctx.correlationId,
    parent_event_id: null,
    payload,
    sensitive_ref: null,
  });
}

export async function emitAICallEvent(
  ctx: StepContext,
  provider: string,
  model: string,
  latencyMs: number,
  tokenEstimate: number,
  success: boolean,
  errorMsg?: string
): Promise<CrucibleEvent> {
  return emitStepEvent(ctx, success ? "AI_CALL_COMPLETED" : "AI_CALL_FAILED", {
    provider,
    model,
    latency_ms: latencyMs,
    token_estimate: tokenEstimate,
    success,
    ...(errorMsg ? { error: errorMsg } : {}),
  });
}
