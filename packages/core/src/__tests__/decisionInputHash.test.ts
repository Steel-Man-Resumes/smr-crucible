/**
 * Pure tests for the decision_log input fingerprint (no DB). The stored value
 * must be keyed with the server secret, so a short input such as a bare job
 * title cannot be recovered by hashing guesses; it must stay the same for the
 * same input over time; and it must never hold the input itself.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { hashDecisionInput, DECISION_INPUT_HASH_PREFIX } from "../decision";
import { hashUsageKey } from "../rateLimit";
import { serverHashSecret } from "../serverHashSecret";

const SECRET = "test-secret";
// The kind of short input that an unkeyed hash gave away.
const SHORT_INPUTS = ["Forklift Operator", "Welder", "cook", "a", ""];

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Run fn with the secret env vars set as given, then put them back. */
function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("carries the prefix and 32 hex characters", () => {
  const h = hashDecisionInput("Forklift Operator", SECRET);
  assert.ok(h.startsWith(DECISION_INPUT_HASH_PREFIX));
  assert.match(h.slice(DECISION_INPUT_HASH_PREFIX.length), /^[0-9a-f]{32}$/);
  assert.equal(h.length, DECISION_INPUT_HASH_PREFIX.length + 32);
});

test("same input, same secret -> same fingerprint (stable over time, no day salt)", () => {
  assert.equal(hashDecisionInput("Forklift Operator", SECRET), hashDecisionInput("Forklift Operator", SECRET));
});

test("different inputs give different fingerprints", () => {
  assert.notEqual(hashDecisionInput("Forklift Operator", SECRET), hashDecisionInput("Welder", SECRET));
});

test("different secrets give different fingerprints", () => {
  assert.notEqual(hashDecisionInput("Forklift Operator", SECRET), hashDecisionInput("Forklift Operator", "another-secret"));
});

test("the plain sha256 of the input never equals or appears in the stored value", () => {
  for (const input of SHORT_INPUTS) {
    const h = hashDecisionInput(input, SECRET);
    const plain = sha256Hex(input);
    const body = h.slice(DECISION_INPUT_HASH_PREFIX.length);
    assert.notEqual(h, plain);
    assert.notEqual(body, plain.slice(0, 32));
    // The old stored format: an unkeyed sha256 cut to 16 characters.
    assert.notEqual(h, plain.slice(0, 16));
    assert.ok(!h.includes(plain.slice(0, 16)), `old-format hash found for "${input}"`);
    // Nor the plain hash of the domain-separated message (the key must matter).
    assert.ok(!h.includes(sha256Hex(`decision|${input}`).slice(0, 16)));
  }
});

test("the stored value never contains the input", () => {
  for (const input of SHORT_INPUTS.filter((s) => s.length > 1)) {
    const h = hashDecisionInput(input, SECRET);
    assert.ok(!h.toLowerCase().includes(input.toLowerCase()), `input "${input}" found in ${h}`);
  }
});

test("never matches the per-IP usage hash for the same value and secret", () => {
  const key = "Forklift Operator";
  const usage = hashUsageKey(key, "2026-10-01", SECRET);
  const decision = hashDecisionInput(key, SECRET);
  assert.ok(!usage.includes(decision.slice(DECISION_INPUT_HASH_PREFIX.length)));
});

test("default secret: IP_HASH_SECRET wins, then AUTH_SECRET", () => {
  withEnv({ NODE_ENV: "test", IP_HASH_SECRET: "ip-secret", AUTH_SECRET: "auth-secret" }, () => {
    assert.equal(hashDecisionInput("Welder"), hashDecisionInput("Welder", "ip-secret"));
  });
  withEnv({ NODE_ENV: "test", IP_HASH_SECRET: undefined, AUTH_SECRET: "auth-secret" }, () => {
    assert.equal(hashDecisionInput("Welder"), hashDecisionInput("Welder", "auth-secret"));
  });
});

test("production with no secret throws (same rule as the per-IP usage hash)", () => {
  withEnv({ NODE_ENV: "production", IP_HASH_SECRET: undefined, AUTH_SECRET: undefined }, () => {
    assert.throws(() => hashDecisionInput("Welder"), /IP_HASH_SECRET or AUTH_SECRET must be set/);
    assert.throws(() => hashUsageKey("visitor-a", "2026-10-01"), /IP_HASH_SECRET or AUTH_SECRET must be set/);
    assert.throws(() => serverHashSecret("anything"), /IP_HASH_SECRET or AUTH_SECRET must be set to anything/);
  });
});

test("outside production with no secret, a development value is used", () => {
  withEnv({ NODE_ENV: "development", IP_HASH_SECRET: undefined, AUTH_SECRET: undefined }, () => {
    assert.doesNotThrow(() => hashDecisionInput("Welder"));
    assert.equal(hashDecisionInput("Welder"), hashDecisionInput("Welder"));
  });
});
