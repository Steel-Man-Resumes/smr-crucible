import { AsyncLocalStorage } from 'node:async_hooks';

export interface OperationContext {
  operationId: string;
  userId: string;
  endpoint: string;
  pending: Promise<unknown>[];
  accountingIncomplete?: boolean;
}
const operations = new AsyncLocalStorage<OperationContext>();
export function currentAiOperation(): OperationContext | undefined { return operations.getStore(); }
export function withAiOperation<T>(context: OperationContext, run: () => T): T {
  return operations.run(context, run);
}
export function trackUsageWrite(write: Promise<unknown>): void {
  operations.getStore()?.pending.push(write);
}
