import { Queue } from "bullmq";

let queue: Queue | null = null;

function parseRedisUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
  };
}

export function getQueue(): Queue {
  if (!queue) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");
    queue = new Queue("crucible-jobs", { connection: parseRedisUrl(redisUrl) });
  }
  return queue;
}
