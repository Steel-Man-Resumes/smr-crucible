import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAssistantArrival, waitForAssistantArrival, type ArrivalSnapshot } from "../assistant-arrival";
const ready: ArrivalSnapshot = { pathname: "/dashboard/jobs", search: "", readyPath: "/dashboard/jobs", visible: true };
test("pathname alone never confirms destination content or its selected job", () => {
  assert.equal(matchesAssistantArrival("/dashboard/jobs", { ...ready, readyPath: "/dashboard" }), false);
  assert.equal(matchesAssistantArrival("/dashboard/jobs", { ...ready, visible: false }), false);
  assert.equal(matchesAssistantArrival("/dashboard/jobs?job=chosen", ready), false);
  assert.equal(matchesAssistantArrival("/dashboard/jobs?job=chosen", { ...ready, search: "?job=chosen" }), true);
});
test("a committed route needs stable visible evidence and never claims data loaded", async () => {
  let reads = 0;
  const result = await waitForAssistantArrival("/dashboard/jobs", { signal: new AbortController().signal, originPath: "/dashboard", intervalMs: 1, timeoutMs: 500,
    read: () => ++reads < 3 ? { ...ready, readyPath: null } : ready });
  assert.deepEqual(result, { ok: true, navigated: true, contentVisible: true, dataLoaded: false });
  assert.equal(reads, 4);
});
test("account switch/unmount cancellation and timeout cannot become false arrival", async () => {
  const controller = new AbortController();
  const promise = waitForAssistantArrival("/dashboard/jobs", { signal: controller.signal, originPath: "/dashboard", read: () => ({ ...ready, readyPath: null }), intervalMs: 1 });
  controller.abort();
  assert.deepEqual(await promise, { ok: false, navigated: false, reason: "cancelled" });
  assert.deepEqual(await waitForAssistantArrival("/dashboard/jobs", { signal: new AbortController().signal, originPath: "/dashboard", read: () => ({ ...ready, readyPath: null }), intervalMs: 1, timeoutMs: 5 }), { ok: false, navigated: false, reason: "timeout" });
});
test("a person going elsewhere interrupts the pending navigation", async () => {
  assert.deepEqual(await waitForAssistantArrival("/dashboard/jobs", { signal: new AbortController().signal, originPath: "/dashboard", read: () => ({ ...ready, pathname: "/dashboard/settings" }) }), { ok: false, navigated: false, reason: "left-route" });
});
