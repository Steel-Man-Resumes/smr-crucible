import { beginAiOperation } from './ai-operation-server';
import { withAiOperation } from './ai-operation-context';
import { recordTokenUsage } from './ai-usage-log';

/** A streaming response returns before provider work ends. Keep its operation
 * open through the final callback, and re-enter context for every callback. */
export async function beginChatOperation(userId: string | null, endpoint: string, model: string) {
  const operation = userId ? await beginAiOperation({userId, endpoint}) : null;
  let failed = false;
  const run = <T>(callback: () => T): T => operation
    ? withAiOperation(operation.context, callback) : callback();
  return {
    response: operation?.response,
    run,
    finish: () => run(async () => { await operation?.finish(failed ? 'failed' : 'succeeded'); }),
    fail: () => run(async () => {
      if (failed) return;
      failed = true;
      // A transport/stream failure can occur between reported steps. Preserve
      // known step costs and explicitly mark the unreported portion unknown.
      await recordTokenUsage('anthropic', model, {inputTokens:0, outputTokens:0},
        {userId, endpoint, usageMissing:true, outcome:'failed'});
      await operation?.finish('failed');
    }),
  };
}
