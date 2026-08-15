/**
 * Phase 7.7 -- pure tests for the ATOMIC reserve cap decision (no DB).
 *
 * reserveEndpointSlot does a single atomic upsert that RETURNs the post-increment
 * call_count, then decides ok via slotWithinCap(count, cap). The DB round-trip is
 * exercised live by the avatar verify script; here we assert the ok/count
 * SEQUENCE that a serialized run of concurrent reserves produces -- counts 1..N
 * against a cap, which is exactly what fixes the TOCTOU (only the first `cap`
 * callers get ok:true).
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { slotWithinCap } from "../rateLimit";
import { HEADSHOT_DAILY_CAP } from "../avatarAssetShared";

test("slotWithinCap: cap=3 -> counts 1,2,3 ok, 4th not ok", () => {
  const cap = 3;
  // Simulate the distinct post-increment counts concurrent reserves receive.
  const counts = [1, 2, 3, 4];
  const verdicts = counts.map((c) => slotWithinCap(c, cap));
  assert.deepEqual(verdicts, [true, true, true, false]);
});

test("slotWithinCap: exactly the cap is allowed, one past is not", () => {
  assert.equal(slotWithinCap(3, 3), true); // the cap-th call is the last allowed
  assert.equal(slotWithinCap(4, 3), false); // strictly past the cap -> rejected
});

test("slotWithinCap: uses the shared HEADSHOT_DAILY_CAP (3) as the headshot cap", () => {
  assert.equal(HEADSHOT_DAILY_CAP, 3);
  // First HEADSHOT_DAILY_CAP reserves ok, the next rejected -- no paid call.
  const seq = [1, 2, 3, 4, 5].map((c) => slotWithinCap(c, HEADSHOT_DAILY_CAP));
  assert.deepEqual(seq, [true, true, true, false, false]);
});

test("slotWithinCap: cap=1 admits only the first caller", () => {
  assert.deepEqual([1, 2].map((c) => slotWithinCap(c, 1)), [true, false]);
});
