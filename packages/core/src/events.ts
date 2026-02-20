import { query } from "./db";
import type { CrucibleEvent } from "./types";

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
