/**
 * Consent-as-a-service for consumer module.
 * Layered consent: core / enhanced / research / sharing / outcome_anonymous / outcome_named
 * Each layer independently grantable and revocable.
 * Audit trail via consumer_consent table (current state) + consumer_consent_event
 * table (immutable history, Phase 1B, migration 034) + org event log.
 */

import { query, getOne, insert } from "./db";
import { emitEvent } from "./events";

export type ConsentLayer =
  | "core"
  | "enhanced"
  | "research"
  | "sharing"
  | "outcome_anonymous"
  | "outcome_named"
  // Phase 5.1 (migration 041): opt-in transcript retention. Storing an
  // encrypted, text-only rehearsal/interview transcript is a data-retention
  // decision, so both default to declined (see consentDefaultFor).
  | "disclosure_transcript"
  | "interview_transcript";

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

/** Optional detail threaded into the immutable consumer_consent_event row. */
export interface ConsentEventOptions {
  /** How consent was collected, e.g. "settings", "forge_onboarding". Defaults to "settings". */
  collectionMethod?: string;
  /** Free-form provenance, e.g. { reason: "mutual_exclusivity" }. */
  context?: Record<string, unknown>;
}

/**
 * Write one row to the immutable consumer_consent_event history table.
 *
 * Tradeoff, deliberate: this is awaited (not fire-and-forget) so a failure is
 * caught and logged loudly here rather than surfacing as an unhandled
 * rejection somewhere downstream -- but the error is swallowed, not
 * rethrown. The consumer_consent row already stood as granted/revoked before
 * this runs; a lost history row is a gap worth logging, not a reason to 500
 * a consent toggle the user is waiting on.
 */
async function recordConsentEvent(
  userId: string,
  layer: ConsentLayer,
  action: "granted" | "revoked",
  textVersion: string,
  opts: ConsentEventOptions = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO consumer_consent_event
         (user_id, consent_layer, action, text_version, collection_method, context)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        layer,
        action,
        textVersion,
        opts.collectionMethod ?? "settings",
        JSON.stringify(opts.context ?? {}),
      ]
    );
  } catch (err) {
    console.error(
      `consumer_consent_event insert failed (user ${userId}, layer ${layer}, action ${action}):`,
      err
    );
  }
}

/**
 * Grant consent for a specific layer. Upserts — if previously revoked,
 * re-grants with new timestamp and version.
 */
export async function grantConsent(
  userId: string,
  layer: ConsentLayer,
  textVersion: string,
  context: Record<string, unknown> = {},
  opts: ConsentEventOptions = {}
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

  // Immutable history (Phase 1B) -- see recordConsentEvent's doc-comment for
  // the await-but-swallow tradeoff.
  await recordConsentEvent(userId, layer, "granted", textVersion, opts);

  // Best-effort audit -- the event table needs a real org FK (sentinel org may
  // not exist on a fresh DB); never let a missing audit row fail a consent grant.
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
  }).catch(() => {});

  return rows[0];
}

/** The consent text version a revoke stamps when NO prior row exists (an
 *  opt-out-default layer like "enhanced" can be revoked before it was ever
 *  explicitly granted -- the revoke must still stick). Grants pass their own
 *  version explicitly. */
export const CONSENT_TEXT_VERSION = "2026-06-07-v1";

/**
 * Revoke consent for a specific layer. UPSERT, not update-only: a layer whose
 * default is "granted" (see consentDefaultFor) may have no row yet, and the
 * revoke must create one -- otherwise isConsentGranted keeps returning the
 * default and the user's opt-out silently does nothing (live-verified bug,
 * 2026-08-10).
 */
export async function revokeConsent(
  userId: string,
  layer: ConsentLayer,
  opts: ConsentEventOptions = {}
): Promise<ConsumerConsent | null> {
  const rows = await query<ConsumerConsent>(
    `INSERT INTO consumer_consent (user_id, consent_layer, status, revoked_at, consent_text_version)
     VALUES ($1, $2, 'revoked', now(), $3)
     ON CONFLICT (user_id, consent_layer)
     DO UPDATE SET status = 'revoked', revoked_at = now()
     RETURNING *`,
    [userId, layer, CONSENT_TEXT_VERSION]
  );

  if (rows[0]) {
    // Immutable history (Phase 1B) -- text_version carries forward from the
    // consumer_consent row being revoked (the version last agreed to), since
    // a revoke has no new text to agree to.
    await recordConsentEvent(
      userId,
      layer,
      "revoked",
      rows[0].consent_text_version,
      opts
    );

    // Best-effort audit (see grantConsent) -- never block a revoke on the event write.
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
    }).catch(() => {});
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

// ─── Default-consent doctrine (Phase 1B) ───────────────────────────────────
//
// A user who has never touched a toggle has no row in consumer_consent for
// that layer. "No row" is not "no consent" -- it means the default applies,
// and the default depends on what the layer does:
//
//   - core:     essential service operation. The product cannot run without
//               it. Granted by default (opt-out doesn't really make sense,
//               but the layer exists for symmetry and future auditability).
//   - enhanced: AI memory and personalization (t.ROY/coach remembering prior
//               turns). This is disclosed honestly in Settings and the
//               Security page, and is one toggle away from off. Granted by
//               default -- opt-out, not opt-in -- because it is a feature of
//               using the product, not a data-sharing decision.
//   - research, sharing, outcome_anonymous, outcome_named: these send the
//               user's data somewhere beyond their own use of the product
//               (a research dataset, a partner org, a published success
//               story). Declined by default -- opt-in only, on purpose.

export type ConsentDefault = "granted" | "declined";

export function consentDefaultFor(layer: ConsentLayer): ConsentDefault {
  return layer === "core" || layer === "enhanced" ? "granted" : "declined";
}

/**
 * The one call every consent-gated code path should use: is this layer in
 * effect for this user right now. Applies consentDefaultFor() when the user
 * has no consumer_consent row for the layer yet, instead of treating an
 * absent row as "declined" across the board.
 */
export async function isConsentGranted(
  userId: string,
  layer: ConsentLayer
): Promise<boolean> {
  const record = await getOne<Pick<ConsumerConsent, "status">>(
    `SELECT status FROM consumer_consent WHERE user_id = $1 AND consent_layer = $2`,
    [userId, layer]
  );
  if (!record) return consentDefaultFor(layer) === "granted";
  return record.status === "granted";
}

// ─── Data access audit (Phase 1B) ──────────────────────────────────────────

/**
 * Record one read/export of a user's (or a cohort's) data by another party,
 * into data_access_log (migration 005 -- previously defined, never written
 * to). Non-fatal by design: an audit-log write failing must never block the
 * read it is auditing.
 *
 * data_access_log has no dedicated free-form context column, so `context`
 * (e.g. { clientCount }) is stored in fields_accessed -- that column is JSONB
 * with no array constraint, and there is no better-fitting column for it.
 *
 * subjectUserId is optional because some reads (a partner's whole cohort)
 * have no single subject; when absent, target_user_id falls back to the
 * accessor's own id so the NOT NULL constraint is satisfied without
 * inventing a fake subject.
 */
export async function recordDataAccess(opts: {
  accessorUserId: string;
  subjectUserId?: string | null;
  resource: string;
  action: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const { accessorUserId, subjectUserId, resource, action, context = {} } = opts;
  try {
    await query(
      `INSERT INTO data_access_log
         (target_user_id, accessor_type, accessor_id, resource_type, access_reason, fields_accessed)
       VALUES ($1, 'user', $2, $3, $4, $5)`,
      [
        subjectUserId || accessorUserId,
        accessorUserId,
        resource,
        action,
        JSON.stringify(context),
      ]
    );
  } catch (err) {
    console.error(
      `recordDataAccess failed (accessor ${accessorUserId}, resource ${resource}, action ${action}):`,
      err
    );
  }
}
