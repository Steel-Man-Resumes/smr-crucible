import { Worker, Job } from "bullmq";
import { runPipeline, emitEvent } from "@crucible/core";
import { careerIntakeV1, careerIntakeHandlers } from "./pipelines/careerIntakeV1";
import { careerIntakeV2, careerIntakeV2Handlers } from "./pipelines/careerIntakeV2";
import {
  generateEmployersBattlePlan,
  generateCoverLetter,
  generateAlloyReport,
} from "./generators";
import type { ArtifactJobData } from "./generators";

const PIPELINE_QUEUE = "crucible-pipeline";
const ARTIFACT_QUEUE = "crucible-artifacts";
// Keep legacy queue name for backwards compatibility
const LEGACY_QUEUE = "crucible-jobs";

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

// Pipeline registry
const PIPELINES: Record<string, { def: any; handlers: Record<string, any> }> = {
  career_intake_v1: { def: careerIntakeV1, handlers: careerIntakeHandlers },
  career_intake_v2: { def: careerIntakeV2, handlers: careerIntakeV2Handlers },
};

async function processPipelineJob(job: Job) {
  const { runId, orgId, projectId, userId, pipelineKey } = job.data;

  console.log(`[pipeline] Received job ${job.id}: pipeline=${pipelineKey} run=${runId}`);

  const pipeline = PIPELINES[pipelineKey];
  if (!pipeline) {
    console.error(`Unknown pipeline: ${pipelineKey}`);
    await emitEvent({
      org_id: orgId,
      project_id: projectId,
      run_id: runId,
      step_id: null,
      event_type: "RUN_FAILED",
      severity: "error",
      actor_type: "system",
      actor_user_id: null,
      actor_label: "worker",
      data_classification: "internal",
      retention_class: "standard",
      correlation_id: null,
      parent_event_id: null,
      payload: { error: `Unknown pipeline: ${pipelineKey}` },
      sensitive_ref: null,
    });
    throw new Error(`Unknown pipeline: ${pipelineKey}`);
  }

  // Emit RUN_STARTED
  await emitEvent({
    org_id: orgId,
    project_id: projectId,
    run_id: runId,
    step_id: null,
    event_type: "RUN_STARTED",
    severity: "info",
    actor_type: "system",
    actor_user_id: null,
    actor_label: "worker",
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: null,
    parent_event_id: null,
    payload: { pipeline_key: pipelineKey, job_id: job.id },
    sensitive_ref: null,
  });

  const result = await runPipeline(
    pipeline.def,
    pipeline.handlers,
    runId,
    orgId,
    projectId,
    { userId }
  );

  console.log(`[pipeline] Pipeline ${pipelineKey} completed for run ${runId}`);
  return result;
}

// Generator registry — maps job_key to generator function
const GENERATORS: Record<string, (data: ArtifactJobData) => Promise<unknown>> = {
  gen_employers: generateEmployersBattlePlan,
  gen_coverletter: generateCoverLetter,
  gen_alloy: generateAlloyReport,
};

async function processArtifactJob(job: Job) {
  const { runId, bundleId, orgId, projectId, artifactKey, params } = job.data;
  const jobKey = job.name; // BullMQ job name = the job_key from runplan
  console.log(`[artifact] Received job ${job.id}: key=${jobKey} artifact=${artifactKey} run=${runId}`);

  const generator = GENERATORS[jobKey];
  if (!generator) {
    console.log(`[artifact] No generator for "${jobKey}" — skipping (not yet implemented)`);
    return { artifactKey, status: 'not_implemented' };
  }

  const data: ArtifactJobData = { runId, bundleId, orgId, projectId, artifactKey, params: params || {} };
  const result = await generator(data);
  console.log(`[artifact] Generator "${jobKey}" completed for artifact=${artifactKey}`);
  return result;
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL environment variable is required");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const connection = parseRedisUrl(redisUrl);

  // Stage A: Pipeline processor (sequential, concurrency 1)
  const pipelineWorker = new Worker(PIPELINE_QUEUE, processPipelineJob, {
    connection,
    concurrency: 1,
  });

  // Legacy queue — same processor for backwards compatibility
  const legacyWorker = new Worker(LEGACY_QUEUE, processPipelineJob, {
    connection,
    concurrency: 1,
  });

  // Stage B: Artifact generator (parallel, concurrency 5)
  const artifactWorker = new Worker(ARTIFACT_QUEUE, processArtifactJob, {
    connection,
    concurrency: 5,
  });

  // Event handlers
  for (const [name, worker] of Object.entries({ pipeline: pipelineWorker, legacy: legacyWorker, artifact: artifactWorker })) {
    worker.on("completed", (job) => {
      console.log(`[${name}] Job ${job?.id} completed`);
    });
    worker.on("failed", (job, err) => {
      console.error(`[${name}] Job ${job?.id} failed:`, err.message);
    });
  }

  console.log(`Worker ready — listening on queues: ${PIPELINE_QUEUE}, ${LEGACY_QUEUE}, ${ARTIFACT_QUEUE}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down worker...");
    await Promise.all([
      pipelineWorker.close(),
      legacyWorker.close(),
      artifactWorker.close(),
    ]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
