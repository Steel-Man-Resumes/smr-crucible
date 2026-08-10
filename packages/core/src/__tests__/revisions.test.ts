/**
 * Phase 1A revision-model tests -- pure parts only, no DB.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashContent } from "../refineryArtifact";

test("hashContent: deterministic for the same content", () => {
  const content = { summary: "Forklift operator", skills: ["OSHA", "inventory"] };
  const a = hashContent(content);
  const b = hashContent({ summary: "Forklift operator", skills: ["OSHA", "inventory"] });
  assert.equal(a, b);
});

test("hashContent: differs when content changes", () => {
  const before = hashContent({ summary: "Forklift operator" });
  const after = hashContent({ summary: "Forklift operator, certified" });
  assert.notEqual(before, after);
});

test("hashContent: differs on key order when values differ (not a canonicalizer)", () => {
  // hashContent is documented as sha256 of JSON.stringify with no extra
  // canonicalization -- this test locks in that it is NOT order-independent
  // for objects whose JSON.stringify output actually differs.
  const a = hashContent({ b: 2, a: 1 });
  const b = hashContent({ a: 1, b: 2 });
  assert.notEqual(a, b);
});

test("hashContent: empty object still hashes to a stable non-empty string", () => {
  const h = hashContent({});
  assert.equal(typeof h, "string");
  assert.ok(h.length > 0);
  assert.equal(h, hashContent({}));
});
