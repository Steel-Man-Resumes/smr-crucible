import { query, getOne, insert } from './db';
import { emitStepEvent } from './events';

// --- Pipeline Definition Types ---

export interface PipelineStepDef {
  key: string;
  critical: boolean;
  maxRetries: number;
  timeoutMs: number;
}

export interface PipelineDef {
  key: string;
  version: string;
  steps: PipelineStepDef[];
}

export interface StepContext {
  runId: string;
  stepId: string;
  orgId: string;
  projectId: string;
  correlationId: string;
  attempt: number;
}

export type StepHandler = (
  ctx: StepContext,
  input: Record<string, unknown>
) => Promise<Record<string, unknown>>;

// --- DB Row Types ---

interface WorkflowRunRow {
  id: string;
  org_id: string;
  project_id: string;
  pipeline_key: string;
  pipeline_version: string;
  status: string;
  correlation_id: string;
  created_at: string;
}

interface RunStepRow {
  id: string;
  run_id: string;
  step_key: string;
  status: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
}

// --- Pipeline Runner ---

export async function runPipeline(
  def: PipelineDef,
  handlers: Record<string, StepHandler>,
  runId: string,
  orgId: string,
  projectId: string,
  initialInput: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Load the run record
  const run = await getOne<WorkflowRunRow>(
    `SELECT * FROM workflow_run WHERE id = $1`,
    [runId]
  );
  if (!run) throw new Error(`Run ${runId} not found`);

  const correlationId = run.correlation_id;

  // Mark run as running
  await query(
    `UPDATE workflow_run SET status = 'running', started_at = now() WHERE id = $1`,
    [runId]
  );

  let currentInput = { ...initialInput };

  for (const stepDef of def.steps) {
    const handler = handlers[stepDef.key];
    if (!handler) {
      throw new Error(`No handler registered for step: ${stepDef.key}`);
    }

    let stepSucceeded = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= stepDef.maxRetries + 1; attempt++) {
      // Create run_step record
      const step = await insert<RunStepRow>('run_step', {
        run_id: runId,
        step_key: stepDef.key,
        status: 'running',
        attempt,
        started_at: new Date().toISOString(),
      });

      const ctx: StepContext = {
        runId,
        stepId: step.id,
        orgId,
        projectId,
        correlationId,
        attempt,
      };

      // Emit STEP_STARTED
      await emitStepEvent(ctx, 'STEP_STARTED', {
        step_key: stepDef.key,
        attempt,
        max_retries: stepDef.maxRetries,
      });

      try {
        // Run handler with timeout
        const result = await withTimeout(
          handler(ctx, currentInput),
          stepDef.timeoutMs,
          `Step ${stepDef.key} timed out after ${stepDef.timeoutMs}ms`
        );

        // Mark step succeeded
        await query(
          `UPDATE run_step SET status = 'succeeded', finished_at = now() WHERE id = $1`,
          [step.id]
        );

        await emitStepEvent(ctx, 'STEP_COMPLETED', {
          step_key: stepDef.key,
          attempt,
          duration_ms: Date.now() - new Date(step.started_at || Date.now()).getTime(),
        });

        currentInput = { ...currentInput, ...result };
        stepSucceeded = true;
        break;
      } catch (err: any) {
        lastError = err;
        const isLastAttempt = attempt >= stepDef.maxRetries + 1;

        // Mark step failed
        await query(
          `UPDATE run_step SET status = 'failed', finished_at = now(), error_code = $2, error_message = $3 WHERE id = $1`,
          [step.id, err.code || 'STEP_ERROR', err.message?.substring(0, 1000)]
        );

        await emitStepEvent(ctx, 'STEP_FAILED', {
          step_key: stepDef.key,
          attempt,
          error: err.message?.substring(0, 500),
          will_retry: !isLastAttempt,
        });

        if (!isLastAttempt) {
          console.log(`Step ${stepDef.key} attempt ${attempt} failed, retrying...`);
        }
      }
    }

    if (!stepSucceeded) {
      if (stepDef.critical) {
        // Critical step failed — abort the pipeline
        await query(
          `UPDATE workflow_run SET status = 'failed', finished_at = now() WHERE id = $1`,
          [runId]
        );

        await emitStepEvent(
          { runId, stepId: '', orgId, projectId, correlationId, attempt: 0 },
          'RUN_FAILED',
          {
            failed_step: stepDef.key,
            error: lastError?.message?.substring(0, 500),
          }
        );

        throw new Error(`Pipeline failed at critical step: ${stepDef.key} — ${lastError?.message}`);
      } else {
        // Optional step — skip and continue
        // Create a skipped record
        const skippedStep = await insert<RunStepRow>('run_step', {
          run_id: runId,
          step_key: stepDef.key,
          status: 'skipped',
          attempt: 0,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });

        await emitStepEvent(
          { runId, stepId: skippedStep.id, orgId, projectId, correlationId, attempt: 0 },
          'STEP_SKIPPED',
          {
            step_key: stepDef.key,
            reason: lastError?.message?.substring(0, 500),
          }
        );
      }
    }
  }

  // All steps complete — mark run succeeded
  await query(
    `UPDATE workflow_run SET status = 'succeeded', finished_at = now() WHERE id = $1`,
    [runId]
  );

  await emitStepEvent(
    { runId, stepId: '', orgId, projectId, correlationId, attempt: 0 },
    'RUN_COMPLETED',
    { pipeline_key: def.key, pipeline_version: def.version }
  );

  return currentInput;
}

// --- Timeout Helper ---

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
