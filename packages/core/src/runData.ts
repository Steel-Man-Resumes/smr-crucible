import { createHash } from 'crypto';
import { query, getOne, insert } from './db';
import { DATA_PRODUCT_SCHEMAS } from './schemas';

export type DataClassificationLevel = 'pii' | 'sensitive' | 'internal' | 'research_eligible';

export interface PutRunDataMeta {
  schemaVersion?: number;
  classification: DataClassificationLevel;
  producerStepKey: string;
  rawRef?: string;
}

interface RunDataRow {
  id: string;
  run_id: string;
  key: string;
  schema_version: number;
  hash: string;
  classification: string;
  producer_step_key: string;
  data: unknown;
  raw_ref: string | null;
  created_at: string;
}

/**
 * Write a data product to run_data. Write-once: errors if key already exists for this run.
 * Validates against Zod schema if one exists for the key.
 */
export async function putRunData(
  runId: string,
  key: string,
  data: unknown,
  meta: PutRunDataMeta
): Promise<void> {
  // Validate against schema if registered
  const schema = DATA_PRODUCT_SCHEMAS[key];
  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `Validation failed for run_data key "${key}": ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      );
    }
  }

  const canonical = JSON.stringify(data);
  const hash = createHash('sha256').update(canonical).digest('hex');

  await insert('run_data', {
    run_id: runId,
    key,
    schema_version: meta.schemaVersion ?? 1,
    hash,
    classification: meta.classification,
    producer_step_key: meta.producerStepKey,
    data: canonical,
    raw_ref: meta.rawRef ?? null,
  });
}

/**
 * Read a typed data product from run_data.
 * Throws if not found.
 */
export async function getRunData<T = unknown>(
  runId: string,
  key: string
): Promise<T> {
  const row = await getOne<RunDataRow>(
    `SELECT * FROM run_data WHERE run_id = $1 AND key = $2`,
    [runId, key]
  );
  if (!row) {
    throw new Error(`run_data not found: run=${runId} key=${key}`);
  }
  // data comes back as JSONB — already parsed by pg driver
  return row.data as T;
}

/**
 * Check if a data product exists for a run.
 */
export async function hasRunData(
  runId: string,
  key: string
): Promise<boolean> {
  const row = await getOne<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM run_data WHERE run_id = $1 AND key = $2) as exists`,
    [runId, key]
  );
  return row?.exists ?? false;
}

/**
 * List all data products for a run.
 */
export async function listRunData(
  runId: string
): Promise<Array<{ key: string; hash: string; created_at: string }>> {
  return query<{ key: string; hash: string; created_at: string }>(
    `SELECT key, hash, created_at FROM run_data WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId]
  );
}
