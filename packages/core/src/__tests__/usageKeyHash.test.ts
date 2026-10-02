/**
 * Pure tests for the ai_usage key hashing (no DB). The per-IP daily counter
 * must never store the raw IP, must give a stable value within a day (or the
 * limit stops working), and must not let rows be linked across days.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashUsageKey, usageDayUtc, USAGE_KEY_HASH_PREFIX } from "../rateLimit";

const SECRET = "test-secret";

test("hashUsageKey never contains the raw key and carries the hash prefix", () => {
  const h = hashUsageKey("visitor-a", "2026-10-01", SECRET);
  assert.ok(h.startsWith(USAGE_KEY_HASH_PREFIX));
  assert.ok(!h.includes("visitor-a"));
  assert.equal(h.length, USAGE_KEY_HASH_PREFIX.length + 40);
});

test("same IP, same day -> same value (the daily limit still counts)", () => {
  assert.equal(
    hashUsageKey("visitor-a", "2026-10-01", SECRET),
    hashUsageKey("visitor-a", "2026-10-01", SECRET)
  );
});

test("same IP, different day -> different value (no cross-day linking)", () => {
  assert.notEqual(
    hashUsageKey("visitor-a", "2026-10-01", SECRET),
    hashUsageKey("visitor-a", "2026-10-02", SECRET)
  );
});

test("different IPs and different secrets give different values", () => {
  assert.notEqual(
    hashUsageKey("visitor-a", "2026-10-01", SECRET),
    hashUsageKey("visitor-b", "2026-10-01", SECRET)
  );
  assert.notEqual(
    hashUsageKey("visitor-a", "2026-10-01", SECRET),
    hashUsageKey("visitor-a", "2026-10-01", "another-secret")
  );
});

test("usageDayUtc is the UTC calendar date", () => {
  assert.equal(usageDayUtc(new Date("2026-10-01T23:59:59Z")), "2026-10-01");
  assert.equal(usageDayUtc(new Date("2026-10-02T00:00:00Z")), "2026-10-02");
});
