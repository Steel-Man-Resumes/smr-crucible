import { Worker, Job } from "bullmq";
import { runPipeline, emitEvent } from "@crucible/core";
import { careerIntakeV1, careerIntakeHandlers } from "./pipelines/careerIntakeV1";

const QUEUE_NAME = "crucible-jobs";

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
};

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

  console.log(`Worker starting on queue: ${QUEUE_NAME}`);

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { runId, orgId, projectId, userId, pipelineKey } = job.data;

      console.log(`Received job ${job.id}: pipeline=${pipelineKey} run=${runId}`);

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

      // Run the pipeline
      const result = await runPipeline(
        pipeline.def,
        pipeline.handlers,
        runId,
        orgId,
        projectId,
        { userId }
      );

      console.log(`Pipeline ${pipelineKey} completed for run ${runId}`);
      return result;
    },
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`Job ${job?.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  console.log("Worker ready, waiting for jobs...");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down worker...");
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
