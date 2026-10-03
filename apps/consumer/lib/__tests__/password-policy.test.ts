/**
 * One password rule everywhere (F9): register, reset and Settings all refuse
 * what Settings refused, and say why in plain words.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passwordProblem, PASSWORD_MIN_LENGTH } from "../password-policy";

describe("passwordProblem", () => {
  it("refuses the 8-character passwords register and reset used to accept", () => {
    assert.equal(passwordProblem("abcd1234"), `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    assert.equal(passwordProblem("abcdefg12"), `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  });
  it("needs a letter and a number", () => {
    assert.equal(passwordProblem("abcdefghijk"), "Include at least one letter and one number.");
    assert.equal(passwordProblem("12345678901"), "Include at least one letter and one number.");
  });
  it("refuses the common ones", () => {
    assert.match(passwordProblem("Password123") || "", /too common/);
  });
  it("accepts a plain, long-enough password", () => {
    assert.equal(passwordProblem("river stone 42"), null);
  });
  it("refuses non-strings and absurd lengths", () => {
    assert.notEqual(passwordProblem(undefined), null);
    assert.notEqual(passwordProblem(12345678901), null);
    assert.notEqual(passwordProblem("a1".repeat(101)), null);
  });
  it("has no em dashes in any message", () => {
    for (const pw of ["x", "abcdefghijk", "password123", "a1".repeat(101)]) {
      assert.ok(!/—| -- /.test(passwordProblem(pw) || ""));
    }
  });
});
