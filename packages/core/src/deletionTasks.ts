/**
 * Phase 1C: deletion retry ledger (migration 037's deletion_task table).
 *
 * Postgres deletes are synchronous and (mostly) reliable; an R2
 * DeleteObjectCommand is a network call to an external service that can
 * fail transiently. Rather than let delete-data's R2 cleanup block or
 * silently drop a failure, callers enqueue a deletion_task row per object
 * and a cron (apps/consumer/app/api/cron/deletion-retry/route.ts) drains
 * pending rows via runDeletionTasks() until they succeed.
 *
 * Enqueueing is intentionally cheap and side-effect-free at call time --
 * it's just an INSERT. The actual R2 delete only happens inside
 * runDeletionTasks(), so a request handler enqueueing a task never has to
 * wait on R2.
 */
import { insert, query } from "./db";
import { getS3Client } from "./storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

export interface DeletionTaskRecord {
  id: string;
  user_id: string | null;
  target_kind: string;
  target_ref: string;
  status: "pending" | "done" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Record intent to delete something outside Postgres. `targetRef` for
 *  target_kind 'r2_object' is `${bucket}::${objectKey}` so runDeletionTasks
 *  doesn't need a secure_object row to still exist to know where to delete
 *  from (it may already be gone by the time the task runs). */
export async function enqueueDeletion(
  userId: string | null,
  targetKind: string,
  targetRef: string
): Promise<DeletionTaskRecord> {
  return insert<DeletionTaskRecord>("deletion_task", {
    user_id: userId,
    target_kind: targetKind,
    target_ref: targetRef,
    status: "pending",
    attempts: 0,
  });
}

function parseR2TargetRef(targetRef: string): { bucket: string; key: string } {
  const idx = targetRef.indexOf("::");
  if (idx === -1) {
    throw new Error(`Malformed r2_object target_ref (expected "bucket::key"): ${targetRef}`);
  }
  return { bucket: targetRef.slice(0, idx), key: targetRef.slice(idx + 2) };
}

/** Process up to `limit` pending deletion_task rows. Each row is attempted
 *  once per call; success marks it 'done', failure increments attempts and
 *  records last_error but leaves it 'pending' for the next cron run (a task
 *  is only ever marked 'failed' by an operator, not automatically -- retries
 *  are unbounded by design since an orphaned R2 object is a real cost). */
export async function runDeletionTasks(limit = 50): Promise<{ processed: number; succeeded: number }> {
  const tasks = await query<DeletionTaskRecord>(
    `SELECT * FROM deletion_task WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );

  let succeeded = 0;
  const client = getS3Client();

  for (const task of tasks) {
    try {
      if (task.target_kind === "r2_object") {
        const { bucket, key } = parseR2TargetRef(task.target_ref);
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } else {
        throw new Error(`Unknown deletion target_kind: ${task.target_kind}`);
      }
      await query(
        `UPDATE deletion_task SET status = 'done', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [task.id]
      );
      succeeded++;
    } catch (err: any) {
      await query(
        `UPDATE deletion_task SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE id = $1`,
        [task.id, String(err?.message || err)]
      );
    }
  }

  return { processed: tasks.length, succeeded };
}
