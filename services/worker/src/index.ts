import { Worker, Job } from "bullmq";
import { Client } from "pg";

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
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  console.log(`Worker starting on queue: ${QUEUE_NAME}`);

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      console.log(`Received job ${job.id}: ${job.name}`, job.data);

      // Write RUN_QUEUED event to event table
      await db.query(
        `INSERT INTO event (org_id, project_id, run_id, event_type, actor_type, actor_label, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          job.data.org_id,
          job.data.project_id || null,
          job.data.run_id || job.id,
          "RUN_QUEUED",
          "system",
          "worker",
          JSON.stringify(job.data),
        ]
      );

      console.log(`Event logged for job ${job.id}`);
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log(`Job ${job?.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  console.log("Worker ready, waiting for jobs...");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down worker...");
    await worker.close();
    await db.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
