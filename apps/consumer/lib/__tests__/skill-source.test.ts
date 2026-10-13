import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceExplicitlySupportsSkill } from "../skill-source";

test("a named affirmative duty keeps the equivalent skill even when an auditor misses it", () => {
  const source = "Did safety audits.\nCleaned offices and restocked supplies.\nAnswered phones and helped customers.";
  assert.equal(sourceExplicitlySupportsSkill(source, "Safety audits"), true);
  assert.equal(sourceExplicitlySupportsSkill(source, "Restocking supplies"), true);
  assert.equal(sourceExplicitlySupportsSkill(source, "Customer help"), true);
});

test("denials and plans do not establish skills", () => {
  const source = "I did not operate forklifts.\nI want OSHA 10 certification.\nPacked orders.";
  assert.equal(sourceExplicitlySupportsSkill(source, "Forklift operation"), false);
  assert.equal(sourceExplicitlySupportsSkill(source, "OSHA 10 certification"), false);
  assert.equal(sourceExplicitlySupportsSkill(source, "Packing orders"), true);
  assert.equal(sourceExplicitlySupportsSkill("Supervised technicians and drove forklifts.", "Forklift supervision"), false);
});
