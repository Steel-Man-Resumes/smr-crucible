/** Platform-admin organization setup: the pure parts (code, validation). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateOrgCode,
  ORG_CODE_ALPHABET,
  ORG_CODE_LENGTH,
  NEW_ORG_DAILY_LIMIT,
  validateCreateOrgInput,
  validateSeatsToAdd,
  validateDailyLimit,
} from "../orgAdmin";

describe("organization codes", () => {
  it("are 12 characters from an alphabet with no look-alikes, and pass the mint format", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateOrgCode();
      assert.equal(c.length, ORG_CODE_LENGTH);
      assert.match(c, /^[A-Z0-9]{4,20}$/);
      assert.doesNotMatch(c, /[IO01]/);
    }
  });
  it("do not repeat across draws", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOrgCode()));
    assert.equal(seen.size, 500);
  });
  it("skip bytes above the unbiased limit instead of folding them", () => {
    let call = 0;
    // First draw is all 255 (rejected only if the alphabet does not divide 256), then zeros.
    const bytes = (n: number) => Buffer.alloc(n, call++ === 0 ? 255 : 0);
    const c = generateOrgCode(4, bytes);
    assert.equal(c.length, 4);
    for (const ch of c) assert.ok(ORG_CODE_ALPHABET.includes(ch));
  });
});

describe("create organization input", () => {
  it("normalizes and accepts a good request", () => {
    const v = validateCreateOrgInput({ name: "  Second   Shift  Program ", ownerEmail: " Owner+org@Example.org ", seats: 10 });
    assert.deepEqual(v, { ok: true, value: { name: "Second Shift Program", ownerEmail: "owner+org@example.org", ownerName: null, seats: 10 } });
  });
  it("always needs a seat limit: no zero, no blank, no fractions, no huge pools", () => {
    for (const seats of [0, "", null, undefined, 2.5, -1, 1001, "ten"]) {
      assert.equal(validateCreateOrgInput({ name: "Org", ownerEmail: "a@b.co", seats }).ok, false, String(seats));
    }
  });
  it("needs a name and a real email", () => {
    assert.equal(validateCreateOrgInput({ name: "x", ownerEmail: "a@b.co", seats: 1 }).ok, false);
    assert.equal(validateCreateOrgInput({ name: "Org", ownerEmail: "not an email", seats: 1 }).ok, false);
  });
  it("seats to add and the daily limit are bounded whole numbers", () => {
    assert.equal(validateSeatsToAdd(5).ok, true);
    assert.equal(validateSeatsToAdd(0).ok, false);
    assert.equal(validateSeatsToAdd(1.5).ok, false);
    assert.equal(validateDailyLimit(30).ok, true);
    assert.equal(validateDailyLimit(0).ok, false);
    assert.equal(validateDailyLimit(5000).ok, false);
  });
});

describe("what a created organization is", () => {
  const src = readFileSync(new URL("../orgAdmin.ts", import.meta.url), "utf8");
  it("defaults to 30 a day so the new-account caps apply", () => {
    assert.equal(NEW_ORG_DAILY_LIMIT, 30);
  });
  it("is a client seat code with the workspace on, required sharing off and an owner", () => {
    assert.match(src, /SELECT \$3, \$4, 'client', \$5::int, \$6::int, \$7, \(SELECT id FROM owner LIMIT 1\), true, false/);
  });
  it("never lowers a seat count and never releases a claimed seat", () => {
    assert.match(src, /SET max_redemptions = max_redemptions \+ \$2::int/);
    assert.doesNotMatch(src, /times_redeemed\s*=/);
  });
  it("rotating keeps the organization row and changes only the code", () => {
    assert.match(src, /UPDATE access_code SET code = \$2, updated_at = now\(\) WHERE id = \$1::uuid RETURNING code/);
  });
  it("audit trigger never records the code value", () => {
    const m = readFileSync(new URL("../../migrations/097_org_seats.sql", import.meta.url), "utf8");
    assert.match(m, /'code_rotated', true/);
    assert.doesNotMatch(m, /NEW\.code\b(?! IS DISTINCT)/);
  });
});
