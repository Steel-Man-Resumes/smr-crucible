import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute the real helper with in-memory imports in a fresh VM. No installed
// modules, require hooks, process globals or provider/database code are changed.
const code = ts.transpileModule(fs.readFileSync(path.resolve(process.cwd(), "lib/ai-chat-operation.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
interface Handle { response?: Response; markProviderAttempted(): void; finish(): Promise<void>; fail(): Promise<void> }
interface State {
  limit: number; bonus: number; count: number; refunds: number;
  starts: Array<{ legacyOverage: boolean }>; finishes: string[]; usage: unknown[][];
  context: { pending: Promise<unknown>[]; failed?: boolean; providerAttempted?: boolean };
  denied?: Response; beginError?: boolean; policyError?: boolean;
}
function setup(overrides: Partial<State> = {}) {
  const state: State = { limit: 30, bonus: 2, count: 30, refunds: 0, starts: [], finishes: [], usage: [], context: { pending: [] }, ...overrides };
  const exports = {} as { beginChatOperation: (user: string | null, endpoint: string, model: string) => Promise<Handle> };
  const modules: Record<string, unknown> = {
    "./ai-operation-server": { beginAiOperation: async (input: { legacyOverage: boolean }) => {
      state.starts.push(input);
      if (state.beginError) throw new Error("Mock admission unavailable");
      return { context: state.context, response: state.denied, finish: async (status: string) => { state.finishes.push(status); } };
    } },
    "./ai-operation-context": { withAiOperation: (_context: unknown, callback: () => unknown) => callback() },
    "./ai-usage-log": { recordTokenUsage: async (...args: unknown[]) => { state.usage.push(args); } },
    "@crucible/core": {
      getUserDailyLimit: async () => state.limit,
      incrementUserUsage: async () => ++state.count,
      refundUserUsage: async () => { state.refunds++; state.count--; },
    },
    "@/lib/progression-server": { progressionLegacyBonus: async () => {
      if (state.policyError) throw new Error("Mock policy unavailable");
      return state.bonus;
    } },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unmocked chat dependency: ${name}`);
    return modules[name];
  }, Response, console });
  return { state, begin: exports.beginChatOperation };
}

test("awarded chat overage is admitted and successful work stays charged", async () => {
  const { state, begin } = setup(); const handle = await begin("user", "coach", "model");
  assert.equal(handle.response, undefined); assert.equal(state.starts[0].legacyOverage, true);
  handle.markProviderAttempted(); await handle.finish();
  assert.deepEqual(state.finishes, ["succeeded"]); assert.equal(state.refunds, 0); assert.equal(state.context.providerAttempted, true);
});
test("exhausted legacy quota refunds its increment before rejection", async () => {
  const { state, begin } = setup({ count: 32 }); const handle = await begin("user", "coach", "model");
  assert.equal(handle.response?.status, 429); assert.equal(state.count, 32); assert.equal(state.starts.length, 0); assert.equal(state.refunds, 1);
});
test("global admission denial refunds the reserved legacy slot", async () => {
  const { state, begin } = setup({ denied: Response.json({ error: "Budget reserved" }, { status: 429 }) });
  const handle = await begin("user", "coach", "model");
  assert.equal(handle.response?.status, 429); assert.equal(state.count, 30); assert.equal(state.refunds, 1);
});
test("pre-provider failure refunds without inventing unknown usage", async () => {
  const { state, begin } = setup(); const handle = await begin("user", "coach", "model"); await handle.fail();
  assert.deepEqual(state.finishes, ["failed"]); assert.equal(state.usage.length, 0); assert.equal(state.refunds, 1);
});
test("duplicate error/finish callbacks record usage and refund only once", async () => {
  const { state, begin } = setup(); const handle = await begin("user", "coach", "model"); handle.markProviderAttempted();
  await Promise.all([handle.fail(), handle.fail(), handle.finish()]);
  assert.deepEqual(state.finishes, ["failed"]); assert.equal(state.usage.length, 1); assert.equal(state.refunds, 1);
});
test("known context failure refunds without another missing-usage record", async () => {
  const { state, begin } = setup(); const handle = await begin("user", "coach", "model"); state.context.failed = true; await handle.finish();
  assert.deepEqual(state.finishes, ["failed"]); assert.equal(state.refunds, 1); assert.equal(state.usage.length, 0);
});
test("policy lookup failure never increments the old quota", async () => {
  const { state, begin } = setup({ policyError: true }); const handle = await begin("user", "coach", "model");
  assert.equal(handle.response?.status, 503); assert.equal(state.count, 30); assert.equal(state.refunds, 0);
});
test("admission exception refunds a known reservation", async () => {
  const { state, begin } = setup({ beginError: true }); const handle = await begin("user", "coach", "model");
  assert.equal(handle.response?.status, 503); assert.equal(state.count, 30); assert.equal(state.refunds, 1);
});
test("signed-out assistant uses no signed-in quota operation", async () => {
  const { state, begin } = setup(); const handle = await begin(null, "assistant", "model"); handle.markProviderAttempted(); await handle.finish();
  assert.equal(state.starts.length, 0); assert.equal(state.count, 30);
});
test("an ordinary legacy slot is not recorded as bonus overage", async () => {
  const { state, begin } = setup({ count: 2 }); const handle = await begin("user", "assistant", "model");
  assert.equal(state.starts[0].legacyOverage, false); await handle.finish(); assert.equal(state.refunds, 0);
});
