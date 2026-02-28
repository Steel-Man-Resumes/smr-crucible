/**
 * Consent-as-a-service for consumer module.
 * Layered consent: core / enhanced / research / sharing
 * Each layer independently grantable and revocable.
 * Audit trail via consumer_consent table + event log.
 */

import { query, getOne, insert } from "./db";
import { emitEvent } from "./events";

export type ConsentLayer = "core" | "enhanced" | "research" | "sharing";

export interface ConsumerConsent {
  id: string;
  user_id: string;
  consent_layer: ConsentLayer;
  status: "granted" | "revoked";
  granted_at: string;
  revoked_at: string | null;
  consent_text_version: string;
  collection_method: string;
  collection_context: Record<string, unknown>;
}

/**
 * Grant consent for a specific layer. Upserts — if previously revoked,
 * re-grants with new timestamp and version.
 */
export async function grantConsent(
  userId: string,
  layer: ConsentLayer,
  textVersion: string,
  context: Record<string, unknown> = {}
): Promise<ConsumerConsent> {
  const rows = await query<ConsumerConsent>(
    `INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context)
     VALUES ($1, $2, 'granted', $3, $4)
     ON CONFLICT (user_id, consent_layer)
     DO UPDATE SET
       status = 'granted',
       granted_at = now(),
       revoked_at = NULL,
       consent_text_version = $3,
       collection_context = $4
     RETURNING *`,
    [userId, layer, textVersion, JSON.stringify(context)]
  );

  await emitEvent({
    org_id: "00000000-0000-0000-0000-000000000000", // Consumer context — no org
    project_id: null,
    run_id: null,
    step_id: null,
    event_type: "CONSENT_GRANTED",
    severity: "info",
    actor_type: "user",
    actor_user_id: userId,
    actor_label: null,
    data_classification: "pii",
    retention_class: "long",
    correlation_id: null,
    parent_event_id: null,
    payload: { consent_layer: layer, text_version: textVersion },
    sensitive_ref: null,
  });

  return rows[0];
}

/**
 * Revoke consent for a specific layer.
 */
export async function revokeConsent(
  userId: string,
  layer: ConsentLayer
): Promise<ConsumerConsent | null> {
  const rows = await query<ConsumerConsent>(
    `UPDATE consumer_consent
     SET status = 'revoked', revoked_at = now()
     WHERE user_id = $1 AND consent_layer = $2
     RETURNING *`,
    [userId, layer]
  );

  if (rows[0]) {
    await emitEvent({
      org_id: "00000000-0000-0000-0000-000000000000",
      project_id: null,
      run_id: null,
      step_id: null,
      event_type: "CONSENT_REVOKED",
      severity: "info",
      actor_type: "user",
      actor_user_id: userId,
      actor_label: null,
      data_classification: "pii",
      retention_class: "long",
      correlation_id: null,
      parent_event_id: null,
      payload: { consent_layer: layer },
      sensitive_ref: null,
    });
  }

  return rows[0] ?? null;
}

/**
 * Check if a specific consent layer is currently granted.
 */
export async function hasConsent(
  userId: string,
  layer: ConsentLayer
): Promise<boolean> {
  const record = await getOne<ConsumerConsent>(
    `SELECT * FROM consumer_consent
     WHERE user_id = $1 AND consent_layer = $2 AND status = 'granted'`,
    [userId, layer]
  );
  return !!record;
}

/**
 * Get all consent records for a user (for consent dashboard display).
 */
export async function getUserConsents(
  userId: string
): Promise<ConsumerConsent[]> {
  return query<ConsumerConsent>(
    `SELECT * FROM consumer_consent WHERE user_id = $1 ORDER BY consent_layer`,
    [userId]
  );
}

/**
 * Check multiple consent layers at once.
 */
export async function checkConsents(
  userId: string,
  layers: ConsentLayer[]
): Promise<Record<ConsentLayer, boolean>> {
  const records = await query<ConsumerConsent>(
    `SELECT consent_layer, status FROM consumer_consent
     WHERE user_id = $1 AND consent_layer = ANY($2)`,
    [userId, layers]
  );

  const result: Record<string, boolean> = {};
  for (const layer of layers) {
    result[layer] =
      records.find((r) => r.consent_layer === layer)?.status === "granted";
  }
  return result as Record<ConsentLayer, boolean>;
}
